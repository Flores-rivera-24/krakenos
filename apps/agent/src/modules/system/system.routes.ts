import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createReadStream, createWriteStream, readFileSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import { dirname, resolve } from 'node:path';
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
import { detectDeployMode } from '../../system/deploy-mode.js';
import { resolveDbFile, stageRestoreAsync, stageRestoreFromFileAsync } from '../../system/restore.js';
import { readStorageInfo } from '../../system/storage.js';
import { UpdateChecker } from '../../system/update-check.js';
import { createUpdateSpawner } from '../../system/update-spawner.js';
import { IntegrationConfigStore } from '../../integrations/integration-config.store.js';
import { createSecretbox, generateSecretboxKey, type Secretbox } from '../../config/secretbox.js';
import { AutoBackupService } from './auto-backup.service.js';
import type { MetricsSnapshot, StorageInfo } from '@krakenos/types';
import type { InventoryService } from '../inventory/inventory.service.js';
import { SupportService } from './support.service.js';
import { UpdateService, type UpdateSpawner } from './update.service.js';
import {
  autoBackupPassphraseSchema,
  autoBackupRevealSchema,
  autoBackupStatusSchema,
  backupSchema,
  connectivityTestSchema,
  getSettingsSchema,
  metricsSchema,
  regenKeysSchema,
  restoreSchema,
  restoreUploadSchema,
  supportBundleSchema,
  systemInfoSchema,
  systemStatsSchema,
  telemetrySchema,
  updateApplySchema,
  updateCancelSchema,
  updateCheckSchema,
  updatePlanSchema,
  updateSettingSchema,
} from './system.schemas.js';

interface SystemRoutesOpts {
  driver: HardwareDriver;
  /** Servicio de inventario compartido, para reprogramar el barrido en caliente. */
  inventoryService?: InventoryService;
  /** Modo de despliegue forzado (US-190; por defecto se autodetecta). Tests. */
  deployMode?: 'systemd' | 'docker';
  /** Spawner del proceso actualizador (US-190; por defecto el real). Tests. */
  updateSpawner?: UpdateSpawner;
  /** Directorio de traspaso del actualizador (US-190; por defecto `var/`). Tests. */
  updateVarDir?: string;
  /** Store de integraciones para el bundle de soporte (US-192; opcional). */
  integrationStore?: IntegrationConfigStore;
  /** Tope de la subida de restauración (US-233; por defecto 2 GB). Tests. */
  maxRestoreBytes?: number;
  /** Secretbox real para la contraseña de la copia automática (US-233). */
  secretbox?: Secretbox;
  /** Servicio de copias automáticas ya construido (US-233; server.ts lo comparte). */
  autoBackupService?: AutoBackupService;
  /** Directorio de copias automáticas (US-233; por defecto `data/backups`). Tests. */
  autoBackupDir?: string;
}

/**
 * Tope de la subida de restauración (US-233). Sin `bodyLimit` el límite lo pone
 * esto: muy por encima de la base proyectada (~305 MB) pero acotado para que una
 * subida hostil no llene el disco.
 */
const MAX_RESTORE_BYTES = 2 * 1024 * 1024 * 1024;

/** Marca de «subida demasiado grande» para responder 413 y no 400. */
class RestoreTooLargeError extends Error {}

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
  homeLatitude: '',
  homeLongitude: '',
  presenceGraceMin: '10',
  presenceLeaveSweeps: '2',
  presenceNightSuppress: '',
  digestFrequency: 'off',
  autoBackupFrequency: 'off',
  autoBackupRetention: '7',
  updateMaintenanceWindow: '',
  telemetryEnabled: 'off',
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

/** No sondear el driver para métricas más de una vez cada 30 s (US-191). */
const DRIVER_SAMPLE_THROTTLE_MS = 30_000;

/** Ni medir el disco más de una vez cada 15 s (US-233): `statfs` toca el sistema. */
const STORAGE_SAMPLE_THROTTLE_MS = 15_000;

/**
 * Comprobador de actualizaciones compartido (US-116). Instancia única a nivel de
 * módulo para conservar la caché de 1 h entre peticiones y no golpear la API de
 * GitHub en cada carga de Ajustes. `updateCheckRepo` = null → `enabled:false`.
 */
const updateChecker = new UpdateChecker(AGENT_VERSION, env.updateCheckRepo);

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

/** Ajustes que revelan **dónde** está la casa: solo para admin (AUD3-02). */
const LOCATION_SETTING_KEYS = ['homeLatitude', 'homeLongitude'] as const satisfies readonly SystemSettingKey[];

export const systemRoutes: FastifyPluginAsync<SystemRoutesOpts> = async (app, opts) => {
  const { driver } = opts;

  /**
   * Lee los ajustes editables (allowlist) fusionando defaults + `Setting`.
   *
   * `includeLocation: false` vacía las coordenadas del hogar: son la **ubicación
   * física de la casa** —la misma PII que el bundle de soporte omite a propósito
   * (US-192)— y hasta US-227 las devolvía a cualquier rol autenticado, invitados
   * incluidos (AUD3-02). Solo las ve quien puede editarlas: admin.
   */
  async function readSettings(
    { includeLocation }: { includeLocation: boolean } = { includeLocation: true },
  ): Promise<SystemSettingsResponse> {
    const rows = await app.prisma.setting.findMany({
      where: { key: { in: [...SYSTEM_SETTING_KEYS] } },
    });
    const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    const settings = Object.fromEntries(
      SYSTEM_SETTING_KEYS.map((k) => [k, stored[k] ?? DEFAULT_SETTINGS[k]]),
    ) as Record<SystemSettingKey, string>;
    if (!includeLocation) {
      for (const key of LOCATION_SETTING_KEYS) settings[key] = '';
    }
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

  // Disco y tamaño de la base (US-233 / AUD3-21): el fallo más probable de un
  // aparato sobre SD es quedarse sin espacio, y no lo publicaba nada. Se cachea con
  // throttle porque el panel de salud sondea cada 5 s y `statfs` toca el sistema.
  const dbFile = resolveDbFile(process.env.DATABASE_URL ?? 'file:./dev.db');
  let storageCache: StorageInfo = {
    dbBytes: null,
    diskFreeBytes: null,
    diskTotalBytes: null,
    diskUsedPercent: null,
  };
  let lastStorageAt = 0;
  const refreshStorage = async (): Promise<void> => {
    const now = Date.now();
    if (now - lastStorageAt < STORAGE_SAMPLE_THROTTLE_MS) return;
    lastStorageAt = now;
    storageCache = await readStorageInfo(dbFile);
  };

  /** Instantánea de métricas (US-191), compartida por la ruta y el bundle. */
  function metricsSnapshot(): MetricsSnapshot {
    const mem = process.memoryUsage();
    return app.metrics.snapshot({
      uptimeSeconds: Math.round(process.uptime()),
      memory: { rssBytes: mem.rss, heapUsedBytes: mem.heapUsed, heapTotalBytes: mem.heapTotal },
      websocketClients: app.io?.sockets?.sockets?.size ?? 0,
      storage: storageCache,
    });
  }

  // Observabilidad interna (US-191): métricas HTTP/loop/memoria + latencia del
  // driver. **Lectura autenticada** (cualquier rol); `/health` sigue público y
  // mínimo. Muestrea la latencia del driver con throttle para no martillear el
  // hardware real en cada poll del panel.
  let lastDriverPing = 0;
  app.get('/metrics', { preHandler: app.authenticate, schema: metricsSchema }, async () => {
    const now = Date.now();
    if (now - lastDriverPing > DRIVER_SAMPLE_THROTTLE_MS) {
      lastDriverPing = now;
      const start = Date.now();
      let ok = true;
      try {
        ok = await driver.healthcheck();
      } catch {
        ok = false;
      }
      app.metrics.recordOp(`driver:${driver.kind}`, Date.now() - start, ok);
    }
    await refreshStorage();
    return metricsSnapshot();
  });

  // Telemetría anónima opt-in + bundle de soporte (US-192).
  const readTelemetryEnabled = async (): Promise<boolean> => {
    const row = await app.prisma.setting.findUnique({ where: { key: 'telemetryEnabled' } });
    return row?.value === 'on';
  };
  // `list()` de la store solo redacta (nunca descifra), así que un secretbox
  // efímero basta como fallback cuando no se inyecta la store real (tests).
  const integrationStore =
    opts.integrationStore ??
    new IntegrationConfigStore(app.prisma, createSecretbox(generateSecretboxKey()));
  const supportService = new SupportService({
    prisma: app.prisma,
    integrationStore,
    version: AGENT_VERSION,
    deployMode: opts.deployMode ?? detectDeployMode(),
    driverKind: driver.kind,
    metrics: metricsSnapshot,
    readSettings: async () => (await readSettings()).settings,
    telemetryEnabled: readTelemetryEnabled,
    uptimeSeconds: () => Math.round(process.uptime()),
    now: () => new Date(),
  });

  // Telemetría: lectura autenticada. OFF por defecto → sin recuentos (opt-in).
  app.get('/telemetry', { preHandler: app.authenticate, schema: telemetrySchema }, () =>
    supportService.getTelemetry(),
  );

  // Bundle de soporte: admin activo + auditado. Sanitizado (sin secretos ni PII).
  // Se sirve como descarga JSON.
  app.post(
    '/support-bundle',
    { preHandler: app.requireActiveAdmin, schema: supportBundleSchema },
    async (req, reply) => {
      // El disco es lo primero que se mira en un informe de soporte: que vaya fresco.
      await refreshStorage();
      const bundle = await supportService.buildBundle();
      app.audit({ action: 'system.support-bundle', userId: req.user.sub, ip: req.ip });
      return reply
        .header('content-type', 'application/json')
        .header('content-disposition', 'attachment; filename="krakenos-support.json"')
        .send(bundle);
    },
  );

  // Comprobación de actualizaciones (US-116). Lectura autenticada; opt-in por
  // `UPDATE_CHECK_REPO`. Sin repo, no hay llamada externa (`enabled:false`).
  app.get('/update-check', { preHandler: app.authenticate, schema: updateCheckSchema }, () =>
    updateChecker.check(),
  );

  // Actualización one-click con rollback (US-190). Reusa el comprobador (US-116) y
  // el modo de despliegue: en systemd puede aplicar sola (proceso actualizador
  // aparte con rollback); en Docker devuelve el comando manual.
  const updateService = new UpdateService({
    current: AGENT_VERSION,
    mode: opts.deployMode ?? detectDeployMode(),
    checker: updateChecker,
    readMaintenanceWindow: async () => {
      const row = await app.prisma.setting.findUnique({ where: { key: 'updateMaintenanceWindow' } });
      return row?.value ?? '';
    },
    spawn: opts.updateSpawner ?? createUpdateSpawner(),
    varDir: opts.updateVarDir,
  });

  // Plan de actualización (lectura autenticada): estado + modo + última ejecución.
  app.get('/update/plan', { preHandler: app.authenticate, schema: updatePlanSchema }, () =>
    updateService.getPlan(),
  );

  // Lanzar la actualización (admin activo + auditado). Devuelve 200 con `started`
  // y el motivo; no lanza excepción por "fuera de ventana"/"docker" (es info, no error).
  app.post<{ Body: { force?: boolean } }>(
    '/update/apply',
    { preHandler: app.requireActiveAdmin, schema: updateApplySchema },
    async (req) => {
      const result = await updateService.apply(req.body?.force === true);
      app.audit({
        action: 'system.update.apply',
        userId: req.user.sub,
        detail: result.started ? `→ ${result.message}` : `no aplicada: ${result.message}`,
        ip: req.ip,
      });
      return result;
    },
  );

  // Liberar el lock de «en curso» (US-232). La caducidad automática (proceso
  // muerto o TTL) cubre al actualizador que murió; esto cubre al que está VIVO
  // pero atascado (p. ej. `pnpm install` esperando una red que no vuelve), que
  // antes solo se arreglaba borrando el fichero por SSH.
  app.post('/update/cancel', { preHandler: app.requireActiveAdmin, schema: updateCancelSchema }, async (req) => {
    const cancelled = await updateService.cancel();
    app.audit({
      action: 'system.update.cancel',
      userId: req.user.sub,
      detail: cancelled ? 'lock liberado' : 'sin actualización en curso',
      ip: req.ip,
    });
    return {
      cancelled,
      message: cancelled
        ? 'Actualización cancelada. Ya puedes volver a intentarlo.'
        : 'No hay ninguna actualización en curso.',
    };
  });

  app.get('/settings', { preHandler: app.authenticate, schema: getSettingsSchema }, async (req) =>
    readSettings({ includeLocation: req.user.role === 'admin' }),
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
        // `scanIntervalSec === 0` es un valor especial legítimo (desactiva el
        // barrido), así que se respeta sin acotar; cualquier otro valor —incluido
        // un fraccionario como 0.001— se acota a [min, max] para no degenerar en un
        // bucle apretado de `setInterval`.
        const n = Number(value);
        if (key === 'scanIntervalSec' && n === 0) {
          value = '0';
        } else {
          const clamped = clampToBound(n, bound);
          if (clamped !== null) value = String(clamped);
        }
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
      // El archivo se escribe a un temporal y se sirve por **stream** (US-233): en la
      // escala proyectada, bufferizarlo costaba ~3 copias de la base en RAM (AUD3-15).
      const tmpFile = resolve('var', `backup-${randomUUID()}.kbk`);
      await backupService.createToFile(req.body.passphrase, tmpFile);
      app.audit({ action: 'system.backup', userId: req.user.sub, ip: req.ip });
      const stream = createReadStream(tmpFile);
      // El temporal se borra en cuanto la respuesta termina (o si el cliente aborta).
      const cleanup = (): void => void rm(tmpFile, { force: true }).catch(() => undefined);
      stream.on('close', cleanup);
      stream.on('error', cleanup);
      return reply
        .header('content-type', 'application/octet-stream')
        .header('content-disposition', 'attachment; filename="krakenos-backup.kbk"')
        .send(stream);
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
        staged = await stageRestoreAsync(blob, req.body.passphrase, restoreStagingDir);
      } catch (err) {
        return reply.code(400).send({
          code: 'RESTORE_INVALID',
          message: err instanceof Error ? err.message : 'La copia de seguridad no es válida.',
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

  // Copias automáticas (US-233 / AUD3-21): hasta ahora la única copia era el botón
  // manual, o sea que un aparato 24/7 sobre una SD dependía de que el usuario se
  // acordara. Admin en todo (lectura incluida): es superficie de seguridad, no
  // telemetría, y la ubicación de las copias no debe filtrarse a otros roles.
  const autoBackup =
    opts.autoBackupService ??
    new AutoBackupService({
      prisma: app.prisma,
      secretbox: opts.secretbox ?? createSecretbox(generateSecretboxKey()),
      backupService,
      backupDir: opts.autoBackupDir,
      warn: (message, err) => app.log.warn({ err }, message),
    });

  app.get(
    '/backup/auto',
    { preHandler: app.requireRole('admin'), schema: autoBackupStatusSchema },
    () => autoBackup.getStatus(),
  );

  app.post(
    '/backup/auto/run',
    { preHandler: app.requireActiveAdmin, schema: autoBackupStatusSchema },
    async (req) => {
      const status = await autoBackup.runNow();
      app.audit({
        action: 'system.backup.auto',
        userId: req.user.sub,
        detail: status.lastError ? `fallo: ${status.lastError}` : `${status.count} copias`,
        ip: req.ip,
      });
      return status;
    },
  );

  app.post<{ Body: { passphrase?: string } }>(
    '/backup/auto/passphrase',
    { preHandler: app.requireActiveAdmin, schema: autoBackupPassphraseSchema },
    async (req) => {
      const { generated } = await autoBackup.setPassphrase(req.body?.passphrase);
      app.audit({
        action: 'system.backup.passphrase',
        userId: req.user.sub,
        detail: generated ? 'generada' : 'fijada por el admin',
        ip: req.ip,
      });
      return { passphraseSet: true, generated };
    },
  );

  // Revelar la contraseña es necesario: una copia que nadie puede descifrar no es una
  // copia. No concede nada nuevo (un admin ya puede crear una copia con la
  // contraseña que quiera), pero queda auditado por si acaso.
  app.post(
    '/backup/auto/passphrase/reveal',
    { preHandler: app.requireActiveAdmin, schema: autoBackupRevealSchema },
    async (req) => {
      const passphrase = await autoBackup.revealPassphrase();
      app.audit({ action: 'system.backup.passphrase.reveal', userId: req.user.sub, ip: req.ip });
      return { passphrase };
    },
  );

  // Restauración por **streaming** (US-233): el archivo sube en binario y se escribe
  // a un temporal, sin base64 (que lo inflaba un 33 %) ni el `bodyLimit` de 64 MB de
  // la ruta de arriba — se podía crear un backup más grande de lo que se podía
  // restaurar (AUD3-15). La passphrase va en cabecera, NO en la URL (acabaría en los
  // logs del proxy). El parser de octet-stream está acotado a este módulo.
  app.addContentTypeParser(
    'application/octet-stream',
    (_req, payload, done) => done(null, payload),
  );
  app.post(
    '/restore/upload',
    { preHandler: app.requireActiveAdmin, schema: restoreUploadSchema },
    async (req, reply) => {
      const passphrase = req.headers['x-restore-passphrase'];
      if (typeof passphrase !== 'string' || passphrase.length === 0) {
        return reply
          .code(400)
          .send({ code: 'RESTORE_INVALID', message: 'Falta la contraseña de la copia de seguridad.' });
      }
      const maxBytes = opts.maxRestoreBytes ?? MAX_RESTORE_BYTES;
      const tmpFile = resolve('var', `restore-upload-${randomUUID()}.kbk`);
      await mkdir(dirname(tmpFile), { recursive: true });
      try {
        let bytes = 0;
        const out = createWriteStream(tmpFile, { mode: 0o600 });
        try {
          for await (const chunk of req.body as AsyncIterable<Buffer>) {
            bytes += chunk.length;
            // Cota propia: sin `bodyLimit`, el tope lo pone esto (y no el disco).
            if (bytes > maxBytes) throw new RestoreTooLargeError();
            if (!out.write(chunk)) {
              await once(out, 'drain');
            }
          }
        } finally {
          out.end();
          await once(out, 'close');
        }

        const staged = await stageRestoreFromFileAsync(tmpFile, passphrase, restoreStagingDir);
        app.audit({
          action: 'system.restore.staged',
          userId: req.user.sub,
          detail: `${staged.length} ficheros (subida directa)`,
          ip: req.ip,
        });
        return reply.send({ staged: staged.length, restartRequired: true });
      } catch (err) {
        if (err instanceof RestoreTooLargeError) {
          return reply.code(413).send({
            code: 'RESTORE_TOO_LARGE',
            message: 'La copia supera el tamaño máximo admitido.',
          });
        }
        return reply.code(400).send({
          code: 'RESTORE_INVALID',
          message: err instanceof Error ? err.message : 'La copia de seguridad no es válida.',
        });
      } finally {
        await rm(tmpFile, { force: true });
      }
    },
  );
};
