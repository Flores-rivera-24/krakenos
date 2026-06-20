import os from 'node:os';
import type {
  ConnectivityTestResult,
  HardwareDriver,
  SystemSettingKey,
  SystemSettingsResponse,
  SystemStats,
  UpdateSettingRequest,
} from '@krakenos/types';
import { SYSTEM_SETTING_KEYS } from '@krakenos/types';
import type { FastifyPluginAsync } from 'fastify';
import { env } from '../../config/env.js';
import { rateLimitStore } from '../../plugins/rate-limit-store.js';
import type { InventoryService } from '../inventory/inventory.service.js';
import {
  connectivityTestSchema,
  getSettingsSchema,
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
  trafficRetentionDays: '7',
  auditRetentionDays: '90',
  accessTokenTtl: '900',
  loginRateLimit: '10',
  theme: 'dark',
};

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
      const { key, value } = req.body;
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

  // Zona de peligro: invalida todas las sesiones (todos los usuarios). La rotación
  // real del par RS256 en disco es un paso de despliegue (gen-keys.sh + reinicio).
  app.post('/regen-keys', { preHandler: app.requireRole('admin') }, async (req, reply) => {
    await app.prisma.refreshToken.updateMany({ where: { revoked: false }, data: { revoked: true } });
    app.audit({ action: 'system.regen-keys', userId: req.user.sub, ip: req.ip });
    return reply.code(204).send();
  });
};
