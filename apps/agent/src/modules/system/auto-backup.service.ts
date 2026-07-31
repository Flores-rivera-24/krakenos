import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import {
  AUTO_BACKUP_FREQUENCIES,
  type AutoBackupFrequency,
  type AutoBackupStatus,
} from '@krakenos/types';
import type { Secretbox } from '../../config/secretbox.js';
import { BackupService } from '../../system/backup.service.js';
import { createTickLoop, type TickLoop } from '../../system/tick-loop.js';

/**
 * Copias de seguridad **automáticas** (US-233 / AUD3-21).
 *
 * El agujero que cierra: hasta ahora la única copia era el botón manual de Ajustes.
 * En un aparato que vive 24/7 sobre una tarjeta SD —el fallo de hardware más
 * probable de todo el sistema— eso significa pérdida total salvo que el usuario se
 * acordara de pulsarlo. Ahora hay una copia diaria o semanal en `data/backups/` con
 * retención por número de copias, y la UI avisa si no hay ninguna reciente.
 *
 * **La passphrase.** El formato de copia va cifrado a propósito (contiene la DB, las
 * claves RS256, `secretbox.key` y las credenciales del hardware), así que una copia
 * automática necesita una contraseña que nadie va a teclear a las 3 de la mañana. Se
 * guarda cifrada con secretbox (misma postura que los secretos de integración) y se
 * puede **generar** o **revelar** desde la UI: una copia cuya contraseña nadie puede
 * leer no es una copia. Ojo con lo obvio: quien tenga el disco tiene ambas cosas, así
 * que el valor real está en **llevarse las copias fuera del servidor**, y eso lo dice
 * la UI.
 *
 * **La copia SÍ lleva la actividad por aparato, y es lo correcto** (decisión de
 * US-250, tercer criterio). La copia es un `VACUUM INTO` de la base entera, así que
 * `DeviceTrafficSample` —y mañana el histórico DNS de US-252— viajan dentro. No se
 * excluyen por tres razones, en este orden:
 *
 *  1. Una copia que omite tablas **restaura una casa incompleta**, y lo hace en
 *     silencio: el usuario se entera el día que la necesita, que es el peor día.
 *  2. La copia **se queda en casa**; el bundle de soporte es el que sale. Son
 *     artefactos distintos con destinos distintos, y por eso la decisión de US-250
 *     es opuesta en cada uno (ver `support.service.ts`).
 *  3. El control ya existe y es proporcionado: el archivo va cifrado
 *     (scrypt + AES-256-GCM), **todas** las rutas de copia automática son admin
 *     —incluida la de lectura— y revelar la contraseña queda auditado.
 *
 * Lo que sí exige es no confundir los dos caminos: si alguna vez se ofrece «mandar
 * una copia a soporte», eso NO es este artefacto.
 */

/** Hora local a la que se lanza la copia (minuto del día): 03:00. */
const RUN_MINUTE = 3 * 60;

/** Clave de `Setting` con la passphrase cifrada (nunca sale en claro salvo por su ruta). */
const PASSPHRASE_KEY = 'backup.autoPassphrase';
/** Clave de `Setting` con el resultado de la última copia automática (JSON). */
const LAST_RUN_KEY = 'backup.autoLastRun';

/** Longitud de la passphrase generada (bytes de aleatoriedad → base64url). */
const GENERATED_BYTES = 24;

export interface AutoBackupOptions {
  prisma: PrismaClient;
  secretbox: Secretbox;
  backupService: BackupService;
  /** Directorio de copias (por defecto `data/backups`). */
  backupDir?: string;
  now?: () => Date;
  /** Aviso a los logs (inyectable en tests). */
  warn?: (message: string, err?: unknown) => void;
}

interface LastRun {
  at: string;
  ok: boolean;
  bytes?: number;
  error?: string;
}

function isFrequency(value: unknown): value is AutoBackupFrequency {
  return typeof value === 'string' && (AUTO_BACKUP_FREQUENCIES as readonly string[]).includes(value);
}

/** Genera una passphrase legible y fuerte (base64url, sin caracteres ambiguos de shell). */
export function generateBackupPassphrase(): string {
  return randomBytes(GENERATED_BYTES).toString('base64url');
}

/**
 * ¿El barrido cruza la hora de la copia en (prev, now]? Mismo patrón que el resumen
 * del hogar (US-180): dispara por **cruce**, así que un arranque no lanza copias
 * atrasadas ni un barrido perdido duplica la del día.
 */
export function autoBackupDue(
  frequency: AutoBackupFrequency,
  prev: Date,
  now: Date,
  runMinute = RUN_MINUTE,
): boolean {
  if (frequency === 'off') return false;
  for (const base of [prev, now]) {
    const at = new Date(base);
    at.setHours(Math.floor(runMinute / 60), runMinute % 60, 0, 0);
    if (frequency === 'weekly' && at.getDay() !== 1) continue; // lunes
    if (at > prev && at <= now) return true;
  }
  return false;
}

export class AutoBackupService {
  private readonly backupDir: string;
  private readonly now: () => Date;
  private readonly warn: (message: string, err?: unknown) => void;
  private prevTick: Date | null = null;
  private loop: TickLoop | null = null;
  /** Evita que dos disparos solapados escriban a la vez (barrido + «copiar ahora»). */
  private running: Promise<AutoBackupStatus> | null = null;

  constructor(private readonly opts: AutoBackupOptions) {
    this.backupDir = opts.backupDir ?? resolve('data/backups');
    this.now = opts.now ?? (() => new Date());
    this.warn = opts.warn ?? (() => undefined);
  }

  private async setting(key: string): Promise<string | null> {
    const row = await this.opts.prisma.setting.findUnique({ where: { key } });
    return row?.value ?? null;
  }

  async frequency(): Promise<AutoBackupFrequency> {
    const value = await this.setting('autoBackupFrequency');
    return isFrequency(value) ? value : 'off';
  }

  /** Nº de copias a conservar (acotado: la cota real la aplica el borde de ajustes). */
  private async retention(): Promise<number> {
    const raw = Number(await this.setting('autoBackupRetention'));
    return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 7;
  }

  /** Passphrase en claro, o `null` si no hay ninguna configurada. */
  private async passphrase(): Promise<string | null> {
    const stored = await this.setting(PASSPHRASE_KEY);
    if (!stored) return null;
    try {
      return this.opts.secretbox.decrypt(stored);
    } catch (err) {
      // Fila corrupta o `secretbox.key` cambiada: se avisa y se trata como ausente
      // (patrón US-63). Sin esto, el barrido fallaría en silencio para siempre.
      this.warn('No se pudo descifrar la contraseña de la copia automática', err);
      return null;
    }
  }

  /** Guarda (cifrada) la passphrase indicada, o una generada si no se pasa ninguna. */
  async setPassphrase(passphrase?: string): Promise<{ generated: string | null }> {
    const value = passphrase ?? generateBackupPassphrase();
    const encrypted = this.opts.secretbox.encrypt(value);
    await this.opts.prisma.setting.upsert({
      where: { key: PASSPHRASE_KEY },
      update: { value: encrypted },
      create: { key: PASSPHRASE_KEY, value: encrypted },
    });
    return { generated: passphrase ? null : value };
  }

  /** Devuelve la passphrase en claro (ruta de admin activo, auditada). */
  async revealPassphrase(): Promise<string | null> {
    return this.passphrase();
  }

  private async readLastRun(): Promise<LastRun | null> {
    const raw = await this.setting(LAST_RUN_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as LastRun;
      return typeof parsed?.at === 'string' && typeof parsed.ok === 'boolean' ? parsed : null;
    } catch {
      return null;
    }
  }

  private async writeLastRun(run: LastRun): Promise<void> {
    const value = JSON.stringify(run);
    await this.opts.prisma.setting.upsert({
      where: { key: LAST_RUN_KEY },
      update: { value },
      create: { key: LAST_RUN_KEY, value },
    });
  }

  /** Copias en disco, de la más reciente a la más antigua. */
  private async listBackups(): Promise<{ name: string; bytes: number; at: string }[]> {
    if (!existsSync(this.backupDir)) return [];
    const out: { name: string; bytes: number; at: string }[] = [];
    for (const name of await readdir(this.backupDir)) {
      if (!BackupService.isBackupFileName(name)) continue;
      const st = await stat(join(this.backupDir, name));
      if (st.isFile()) out.push({ name, bytes: st.size, at: st.mtime.toISOString() });
    }
    // El nombre lleva la fecha ISO, así que ordenar por nombre es ordenar por fecha.
    return out.sort((a, b) => (a.name < b.name ? 1 : -1));
  }

  /**
   * Estado para la UI. `stale` es la señal honesta: hay copias automáticas
   * configuradas pero la última es demasiado vieja (o no hay ninguna).
   */
  async getStatus(): Promise<AutoBackupStatus> {
    const [frequency, retention, passphrase, lastRun, files] = await Promise.all([
      this.frequency(),
      this.retention(),
      this.setting(PASSPHRASE_KEY),
      this.readLastRun(),
      this.listBackups(),
    ]);
    const newest = files[0] ?? null;
    const maxAgeMs = (frequency === 'weekly' ? 8 : 2) * 24 * 60 * 60 * 1000;
    const stale =
      frequency !== 'off' &&
      (!newest || this.now().getTime() - Date.parse(newest.at) > maxAgeMs);
    return {
      frequency,
      retention,
      passphraseSet: passphrase !== null,
      count: files.length,
      totalBytes: files.reduce((sum, f) => sum + f.bytes, 0),
      lastBackupAt: newest?.at ?? null,
      lastBackupBytes: newest?.bytes ?? null,
      lastError: lastRun && !lastRun.ok ? (lastRun.error ?? 'error desconocido') : null,
      stale,
    };
  }

  /**
   * Crea una copia ahora y poda las que sobran. No lanza: registra el fallo en el
   * estado (`lastError`) para que la UI lo diga, porque un barrido que revienta en
   * silencio es exactamente lo que hacía inútil el backup manual.
   */
  async runNow(): Promise<AutoBackupStatus> {
    // Single-flight: dos disparos solapados escribirían dos copias a la vez y la
    // poda podría borrar la que se está escribiendo.
    if (this.running) return this.running;
    this.running = this.doRun().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async doRun(): Promise<AutoBackupStatus> {
    const startedAt = this.now();
    try {
      const passphrase = await this.passphrase();
      if (!passphrase) {
        throw new Error(
          'No hay contraseña para la copia automática. Genera una en Ajustes → Sistema.',
        );
      }
      await mkdir(this.backupDir, { recursive: true, mode: 0o700 });
      const dest = join(this.backupDir, BackupService.fileNameFor(startedAt));
      const { bytes } = await this.opts.backupService.createToFile(passphrase, dest);
      await this.prune();
      await this.writeLastRun({ at: startedAt.toISOString(), ok: true, bytes });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'error desconocido';
      this.warn('La copia de seguridad automática falló', err);
      await this.writeLastRun({ at: startedAt.toISOString(), ok: false, error: message }).catch(
        () => undefined,
      );
    }
    return this.getStatus();
  }

  /** Borra las copias que exceden la retención (solo ficheros con NUESTRO nombre). */
  async prune(): Promise<number> {
    const keep = await this.retention();
    const files = await this.listBackups();
    let removed = 0;
    for (const file of files.slice(keep)) {
      await rm(join(this.backupDir, file.name), { force: true });
      removed += 1;
    }
    return removed;
  }

  /**
   * Barrido horario. Igual que el resumen del hogar (US-229/AUD3-18), la ventana
   * avanza **después** de leer la configuración: si la DB falla justo en el barrido
   * que cruza las 03:00, se reintenta al ciclo siguiente en vez de perder la copia
   * de ese día sin dejar rastro.
   */
  async tick(now: Date = this.now()): Promise<void> {
    const prev = this.prevTick;
    const frequency = await this.frequency();
    this.prevTick = now;
    if (!prev) return; // primer barrido: fija la base, no lanza nada atrasado
    if (!autoBackupDue(frequency, prev, now)) return;
    await this.runNow();
  }

  /** Barrido horario por `createTickLoop` (guard de re-entrada + captura, US-229). */
  start(intervalMs = 60 * 60 * 1000): void {
    if (this.loop) return;
    this.loop = createTickLoop({
      intervalMs,
      immediate: true, // fija prevTick sin lanzar copias atrasadas
      tick: () => this.tick(),
      onError: (err) => this.warn('[auto-backup] el barrido falló; se omite este ciclo', err),
      onSkip: () => this.warn('[auto-backup] el barrido anterior sigue en curso; se salta'),
    });
    this.loop.start();
  }

  stop(): void {
    this.loop?.stop();
    this.loop = null;
  }
}
