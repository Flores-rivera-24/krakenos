import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import type { CameraManager, Recording, RecordingConfig } from '@krakenos/types';
import type { FastifyInstance } from 'fastify';
import { asNumber } from '../../db/sql-aggregate.js';
import type { MotionRecorder } from './motion.service.js';

/** Clave del `Setting` con la config global de grabación (US-187). */
const RECORDING_SETTING_KEY = 'cameras.recording';

/** Config por defecto: retención 14 días, tope 2 GB, clips de 10 s. */
export const DEFAULT_RECORDING_CONFIG: RecordingConfig = {
  retentionDays: 14,
  maxTotalMb: 2048,
  clipSeconds: 10,
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Tope del snapshot (caracteres del data URL) que se persiste con la fila. ~700 kB
 * de base64 ≈ 500 kB de JPEG: de sobra para una miniatura de evento y lejos de los
 * megas que puede emitir una cámara 4K (US-228).
 */
const MAX_SNAPSHOT_CHARS = 700_000;

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Normaliza la config de grabación (defensivo, patrón US-63). Puro. */
export function normalizeRecordingConfig(
  raw: unknown,
  base: RecordingConfig = DEFAULT_RECORDING_CONFIG,
): RecordingConfig {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    retentionDays: clampInt(r.retentionDays, 1, 365, base.retentionDays),
    maxTotalMb: clampInt(r.maxTotalMb, 10, 100_000, base.maxTotalMb),
    clipSeconds: clampInt(r.clipSeconds, 3, 120, base.clipSeconds),
  };
}

interface RecordingRow {
  id: string;
  cameraId: string;
  cameraName: string;
  path: string;
  startedAt: Date;
  durationSec: number;
  sizeBytes: number;
  snapshot: string | null;
}

/** Proyección pública: **nunca** expone la ruta en disco (como la `rtspUrl`). */
function toRecording(row: RecordingRow): Recording {
  return {
    id: row.id,
    cameraId: row.cameraId,
    cameraName: row.cameraName,
    startedAt: row.startedAt.toISOString(),
    durationSec: row.durationSec,
    sizeBytes: row.sizeBytes,
    snapshot: row.snapshot,
  };
}

/**
 * Grabación de clips por evento de movimiento (US-187). Implementa `MotionRecorder`:
 * cuando el `MotionService` dispara con `record` activo, captura un clip (contrato
 * `CameraManager.recordClip`), lo escribe a `data/recordings/<cameraId>/` y guarda
 * sus metadatos en `Recording`. Poda por **edad** (días) y por **tamaño total**
 * (GB) — patrón de retención US-102, pero sobre fichero + fila.
 *
 * La ruta en disco nunca sale por la API; la descarga es autenticada por `id`.
 */
export class RecordingService implements MotionRecorder {
  constructor(
    private readonly app: FastifyInstance,
    private readonly cameras: CameraManager,
    private readonly baseDir: string,
    private readonly now: () => number = Date.now,
  ) {}

  // ---- Config (Setting `cameras.recording`) ----

  async getConfig(): Promise<RecordingConfig> {
    const row = await this.app.prisma.setting.findUnique({ where: { key: RECORDING_SETTING_KEY } });
    if (!row) return DEFAULT_RECORDING_CONFIG;
    try {
      return normalizeRecordingConfig(JSON.parse(row.value));
    } catch {
      this.app.log.warn('[recording] ajuste cameras.recording corrupto; se usan los valores por defecto');
      return DEFAULT_RECORDING_CONFIG;
    }
  }

  async setConfig(patch: Partial<RecordingConfig>): Promise<RecordingConfig> {
    const next = normalizeRecordingConfig({ ...(await this.getConfig()), ...patch });
    await this.app.prisma.setting.upsert({
      where: { key: RECORDING_SETTING_KEY },
      create: { key: RECORDING_SETTING_KEY, value: JSON.stringify(next) },
      update: { value: JSON.stringify(next) },
    });
    return next;
  }

  // ---- MotionRecorder ----

  async record(input: {
    cameraId: string;
    cameraName: string;
    detectedAt: string;
    snapshot: string | null;
  }): Promise<void> {
    const cfg = await this.getConfig();
    const bytes = await this.cameras.recordClip(input.cameraId, cfg.clipSeconds);
    if (!bytes || bytes.length === 0) return;

    const id = randomUUID();
    // Cota del snapshot que se guarda EN LA BASE (US-228/AUD3-14): venía acotado
    // solo por el `maxBuffer` de ffmpeg (16 MiB), así que una cámara 4K podía meter
    // megas de base64 por evento dentro de SQLite. Si se pasa, se guarda el clip sin
    // miniatura antes que engordar la base: el vídeo es el dato, la foto es ayuda.
    const snapshot =
      input.snapshot && input.snapshot.length > MAX_SNAPSHOT_CHARS ? null : input.snapshot;
    if (input.snapshot && snapshot === null) {
      this.app.log.warn(
        { cameraId: input.cameraId, chars: input.snapshot.length },
        'Snapshot demasiado grande para guardarlo en la base; se guarda el clip sin miniatura',
      );
    }
    const relPath = join(input.cameraId, `${id}.mp4`);
    const absDir = join(this.baseDir, input.cameraId);
    mkdirSync(absDir, { recursive: true });
    writeFileSync(join(this.baseDir, relPath), bytes);

    await this.app.prisma.recording.create({
      data: {
        id,
        cameraId: input.cameraId,
        cameraName: input.cameraName,
        path: relPath,
        startedAt: new Date(input.detectedAt),
        durationSec: cfg.clipSeconds,
        sizeBytes: bytes.length,
        snapshot,
      },
    });
    await this.prune(cfg);
  }

  // ---- Consulta / descarga / borrado ----

  async list(cameraId?: string, limit = 100): Promise<Recording[]> {
    const rows = await this.app.prisma.recording.findMany({
      where: cameraId ? { cameraId } : undefined,
      orderBy: { startedAt: 'desc' },
      take: limit,
    });
    return rows.map(toRecording);
  }

  /** Fila cruda (con ruta) para la descarga. `null` si no existe. */
  async getRow(id: string): Promise<RecordingRow | null> {
    return this.app.prisma.recording.findUnique({ where: { id } });
  }

  /**
   * Ruta absoluta del fichero de un clip (para servirlo o borrarlo), **contenida**
   * en `baseDir`.
   *
   * `row.path` viene de la DB, y la DB es un destino legítimo de restauración: un
   * backup preparado con `path: "../../keys/jwt-private.pem"` convertía la descarga
   * de un clip en lectura arbitraria de ficheros y `remove()` en borrado arbitrario
   * (AUD3-05). Por eso se valida al **usar** la ruta, no solo al desempaquetar.
   */
  absPath(row: RecordingRow): string {
    const root = resolve(this.baseDir);
    const abs = resolve(root, row.path);
    if (abs !== root && !abs.startsWith(root + sep)) {
      throw new Error(`ruta de grabación fuera del directorio de clips: ${row.path}`);
    }
    return abs;
  }

  async remove(id: string): Promise<boolean> {
    const row = await this.getRow(id);
    if (!row) return false;
    rmSync(this.absPath(row), { force: true });
    await this.app.prisma.recording.delete({ where: { id } });
    return true;
  }

  /**
   * Poda: borra clips más viejos que `retentionDays` y, si el total supera
   * `maxTotalMb`, elimina de los más antiguos hasta bajar del tope. Borra fichero
   * **y** fila. Best-effort (no propaga).
   *
   * El presupuesto cuenta también el **snapshot en base64** que viaja en la fila
   * (US-228/AUD3-14): son ~300 KB por evento guardados dentro de SQLite, así que el
   * «2 GB» configurado se quedaba corto en ~123 MB invisibles para el usuario. Y las
   * consultas seleccionan solo lo que necesitan: traer el base64 de 400 filas para
   * sumar tamaños eran decenas de MB de heap en cada detección de movimiento.
   */
  async prune(cfg?: RecordingConfig): Promise<number> {
    const c = cfg ?? (await this.getConfig());
    let removed = 0;

    // 1) Por edad.
    const cutoff = new Date(this.now() - c.retentionDays * DAY_MS);
    const old = await this.app.prisma.recording.findMany({
      where: { startedAt: { lt: cutoff } },
      select: { id: true },
    });
    for (const row of old) {
      if (await this.remove(row.id)) removed++;
    }

    // 2) Por tamaño total (elimina de los más antiguos). `LENGTH(snapshot)` se
    // calcula en la base para no traer el base64 a memoria solo para pesarlo.
    const maxBytes = c.maxTotalMb * 1024 * 1024;
    const rows = await this.app.prisma.$queryRaw<
      { id: string; sizeBytes: number | bigint; snapshotBytes: number | bigint }[]
    >`
      SELECT id, sizeBytes, COALESCE(LENGTH(snapshot), 0) AS snapshotBytes
      FROM Recording
      ORDER BY startedAt ASC`;
    const weight = (r: { sizeBytes: number | bigint; snapshotBytes: number | bigint }) =>
      asNumber(r.sizeBytes) + asNumber(r.snapshotBytes);
    let total = rows.reduce((sum, r) => sum + weight(r), 0);
    for (const row of rows) {
      if (total <= maxBytes) break;
      if (await this.remove(row.id)) {
        total -= weight(row);
        removed++;
      }
    }
    return removed;
  }
}
