import { readFileSync } from 'node:fs';
import os from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ConnectivityTestResult,
  HardwareDriver,
  SystemPublicInfo,
  SystemSettingKey,
  SystemSettingsResponse,
  SystemStats,
  UpdateSettingRequest,
} from '@krakenos/types';
import { SYSTEM_SETTING_KEYS } from '@krakenos/types';
import type { FastifyPluginAsync } from 'fastify';
import { env, publicDisclosure } from '../../config/env.js';
import { boundFor, clampToBound } from '../../config/settings-bounds.js';
import { rateLimitStore } from '../../plugins/rate-limit-store.js';
import { BackupService } from '../../system/backup.service.js';
import { stageRestore } from '../../system/restore.js';
import type { InventoryService } from '../inventory/inventory.service.js';
import {
  backupSchema,
  connectivityTestSchema,
  getSettingsSchema,
  regenKeysSchema,
  restoreSchema,
  systemInfoSchema,
  systemStatsSchema,
  updateSettingSchema,
} from './system.schemas.js';

interface SystemRoutesOpts {
  driver: HardwareDriver;
  /** Servicio de inventario compartido, para reprogramar el barrido en caliente. */
  inventoryService?: InventoryService;
}

/** Valores por defecto de los ajustes editables (cuando no hay fila en `Setting`). */
const DEFAULT_SETTINGS: Record<SystemSettingKey, string> = {
  homeName: '',
  timezone: 'UTC',
  scanIntervalSec: '60',
  trafficRetentionDays: '30',
  auditRetentionDays: '90',
  accessTokenTtl: '900',
  loginRateLimit: '10',
  theme: 'dark',
};

/**
 * Lee la versión del agente desde su `package.json`. Prueba varias rutas
 * candidatas para funcionar tanto en dev/test (fuente) como en el bundle (`dist/`).
 */
function readAgentVersion(): string {
  for (const rel of ['../../../package.json', '../package.json', '../../package.json']) {
    try {
      const path = fileURLToPath(new URL(rel, import.meta.url));
      const pkg = JSON.parse(readFileSync(path, 'utf8')) as { version?: string };
      if (pkg.version) return pkg.version;
    } catch {
      // siguiente candidato
    }
  }
  return '0.0.0';
}

const AGENT_VERSION = readAgentVersion();

function readStats(): SystemStats {
  const cores = os.cpus().length || 1;
  const load1 = os.loadavg()[0] ?? 0;
  const totalBytes = os.totalmem();
  const usedBytes = totalBytes - os.freemem();

  return {
    uptimeSeconds: Math.round(os.uptime()),
    cpu: {
      cores,
      loadPercent: Math.min(100, Math.round((load1 / cores) * 100)),
    },
    memory: {
      totalBytes,
      usedBytes,
      usedPercent: Math.round((usedBytes / totalBytes) * 100),
    },
    timestamp: new Date().toISOString(),
  };
}

export const systemRoutes: FastifyPluginAsync<SystemRoutesOpts> = async (app, opts) => {
  const { driver } = opts;

  /** Lee los ajustes editables (allowlist) fusionando defaults + `Setting`. */
  async function readSettings(): Promise<SystemSettingsResponse> {
    const rows = await app.prisma.setting.findMany({
      where: { key: { in: [...SYSTEM_SETTING_KEYS] } },
    });
    const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    const settings = Object.fromEntries(
      SYSTEM_SETTING_KEYS.map((k) => [k, stored[k] ?? DEFAULT_SETTINGS[k]]),
    ) as Record<SystemSettingKey, string>;
    return {
      settings,
      info: {
        driver: driver.kind,
        host: env.driver.host ?? null,
        httpsEnabled: env.https !== null,
      },
    };
  }

  // Info pública para la pantalla de login (US-49): nombre del hogar + versión.
  // Sin autenticación; no expone nada sensible.
  app.get('/info', { schema: systemInfoSchema }, async (): Promise<SystemPublicInfo> => {
    const row = await app.prisma.setting.findUnique({ where: { key: 'homeName' } });
    // `version` solo si está habilitada su divulgación pre-auth (US-83): omitirla
    // por defecto evita el fingerprinting/CVE-matching de un atacante no autenticado.
    return {
      homeName: row?.value || 'Mi hogar',
      ...(publicDisclosure.version() ? { version: AGENT_VERSION } : {}),
    };
  });

  app.get('/stats', { preHandler: app.authenticate, schema: systemStatsSchema }, async () =>
    readStats(),
  );

  app.get('/settings', { preHandler: app.authenticate, schema: getSettingsSchema }, async () =>
    readSettings(),
  );

  app.patch<{ Body: UpdateSettingRequest }>(
    '/settings',
    { preHandler: app.requireRole('admin'), schema: updateSettingSchema },
    async (req) => {
      const { key } = req.body;
      let { value } = req.body;

      // Acota los ajustes numéricos sensibles a su rango permitido antes de
      // persistir (US-75, F5): así el valor guardado y el devuelto reflejan el
      // clamp, y el admin ve el valor efectivo. Si no es numérico se deja igual
      // (el lado lector recurre a su fallback).
      const bound = boundFor(key);
      if (bound) {
        const clamped = clampToBound(Number(value), bound);
        if (clamped !== null) value = String(clamped);
      }

      await app.prisma.setting.upsert({
        where: { key },
        create: { key, value },
        update: { value },
      });
      app.audit({ action: 'system.settings.update', userId: req.user.sub, detail: key, ip: req.ip });

      // Ajustes que se aplican en caliente, sin reiniciar el agente (US-47).
      let appliedImmediately = false;
      if (key === 'scanIntervalSec') {
        const sec = Number(value);
        opts.inventoryService?.setScanInterval(sec > 0 ? sec * 1000 : 0);
        appliedImmediately = true;
      } else if (key === 'loginRateLimit') {
        rateLimitStore.update(Number(value));
        appliedImmediately = true;
      }

      return { ...(await readSettings()), appliedImmediately };
    },
  );

  app.post(
    '/connectivity-test',
    { preHandler: app.requireRole('admin'), schema: connectivityTestSchema },
    async (): Promise<ConnectivityTestResult> => {
      const start = Date.now();
      try {
        const ok = await driver.healthcheck();
        return ok
          ? { ok: true, latencyMs: Date.now() - start }
          : { ok: false, error: 'El driver no respondió al healthcheck' };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'Error desconocido' };
      }
    },
  );

  // Zona de peligro: revoca todos los refresh tokens (cierra todas las sesiones de
  // todos los usuarios). OJO: no rota el par RS256 en disco, así que los **access
  // tokens** ya emitidos siguen siendo válidos hasta su `exp` (≤ accessTokenTtl).
  // La rotación real de claves es un procedimiento de despliegue con solape
  // (scripts/rotate-keys.sh + reinicio); ver docs/jwt-key-rotation.md. Combina
  // ambos para responder a una clave comprometida (rotar + revocar refresh).
  app.post('/regen-keys', { preHandler: app.requireRole('admin'), schema: regenKeysSchema }, async (req, reply) => {
    await app.prisma.refreshToken.updateMany({ where: { revoked: false }, data: { revoked: true } });
    app.audit({ action: 'system.regen-keys', userId: req.user.sub, ip: req.ip });
    return reply.code(204).send();
  });

  // Copia de seguridad **real** cifrada (US-103): DB + keys + data. Reemplaza el
  // falso backup que solo exportaba ajustes cosméticos. Admin-only y auditada. El
  // cuerpo de la respuesta es el archivo binario (octet-stream), listo para descargar.
  const backupService = new BackupService(app.prisma);
  app.post<{ Body: { passphrase: string } }>(
    '/backup',
    { preHandler: app.requireActiveAdmin, schema: backupSchema },
    async (req, reply) => {
      const archive = await backupService.create(req.body.passphrase);
      app.audit({ action: 'system.backup', userId: req.user.sub, ip: req.ip });
      return reply
        .header('content-type', 'application/octet-stream')
        .header('content-disposition', 'attachment; filename="krakenos-backup.kbk"')
        .send(archive);
    },
  );

  // Restauración (US-104): sube el backup cifrado (base64) + passphrase. Se descifra,
  // se **valida** (anti path-traversal) y se deja en staging; se aplica al reiniciar
  // (no se puede intercambiar la DB viva de forma segura). Admin activo y auditada.
  // El staging vive en `var/` (FUERA de `data/`), que es un destino de restore — si
  // no, un backup con una entrada `data/restore-staging` colisionaría al aplicar.
  const restoreStagingDir = resolve('var/restore-staging');
  app.post<{ Body: { passphrase: string; data: string } }>(
    '/restore',
    // 64 MB: evita el OOM de bufferizar base64 gigante en hardware tipo Raspberry Pi.
    { preHandler: app.requireActiveAdmin, schema: restoreSchema, bodyLimit: 64 * 1024 * 1024 },
    async (req, reply) => {
      let staged: string[];
      try {
        const blob = Buffer.from(req.body.data, 'base64');
        staged = stageRestore(blob, req.body.passphrase, restoreStagingDir);
      } catch (err) {
        return reply.code(400).send({
          code: 'RESTORE_INVALID',
          message: err instanceof Error ? err.message : 'Backup inválido',
        });
      }
      app.audit({
        action: 'system.restore.staged',
        userId: req.user.sub,
        detail: `${staged.length} ficheros`,
        ip: req.ip,
      });
      return reply.send({ staged: staged.length, restartRequired: true });
    },
  );
};
