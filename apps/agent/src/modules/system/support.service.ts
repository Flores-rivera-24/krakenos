/**
 * Telemetría anónima opt-in + bundle de soporte (US-192).
 *
 * Dos piezas coherentes con el principio local-first y "sin nube":
 *  - **Telemetría** OFF por defecto (SPECS §9.2). Cuando el admin la activa, son
 *    **solo recuentos agregados** (sin nombres, MAC, IP ni ubicación). No se envía
 *    a ningún sitio: el usuario la ve y decide si compartirla.
 *  - **Bundle de soporte**: instantánea **sanitizada** para diagnosticar. Redacta
 *    los secretos de integración (reusa la redacción de `IntegrationConfigStore`),
 *    **omite el nombre y la ubicación del hogar** (PII) y no incluye ni IP ni
 *    actor de la auditoría. Los logs reales viven en journald/docker, no aquí.
 *
 * Los helpers de sanitización son **puros** (testeables sin DB); el ensamblado
 * recibe sus dependencias inyectadas.
 */

import type { PrismaClient } from '@prisma/client';
import type {
  DeployMode,
  MetricsSnapshot,
  SupportBundle,
  TelemetrySnapshot,
} from '@krakenos/types';
import type { IntegrationConfigStore } from '../../integrations/integration-config.store.js';

/**
 * Ajustes que NO deben salir en el bundle por ser PII: el nombre del hogar y su
 * **ubicación** (lat/long para el cálculo solar, US-168). El resto de la allowlist
 * es configuración no sensible.
 */
export const PII_SETTING_KEYS = ['homeName', 'homeLatitude', 'homeLongitude'];

/** Quita las claves PII de los ajustes antes de meterlos en el bundle. */
export function sanitizeSettings(settings: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(settings)) {
    if (!PII_SETTING_KEYS.includes(key)) out[key] = value;
  }
  return out;
}

/** Construye la instantánea de telemetría: recuentos solo si está activada. */
export function buildTelemetry(
  enabled: boolean,
  version: string,
  counts: NonNullable<TelemetrySnapshot['counts']>,
): TelemetrySnapshot {
  return enabled ? { enabled: true, version, counts } : { enabled: false, version };
}

export interface SupportServiceDeps {
  prisma: PrismaClient;
  integrationStore: IntegrationConfigStore;
  version: string;
  deployMode: DeployMode;
  driverKind: string;
  /** Instantánea de métricas (US-191). */
  metrics: () => MetricsSnapshot;
  /** Ajustes efectivos (allowlist) ya resueltos. */
  readSettings: () => Promise<Record<string, string>>;
  /** ¿Está la telemetría activada? (ajuste `telemetryEnabled`). */
  telemetryEnabled: () => Promise<boolean>;
  uptimeSeconds: () => number;
  now: () => Date;
}

export class SupportService {
  constructor(private readonly deps: SupportServiceDeps) {}

  private async gatherCounts(): Promise<NonNullable<TelemetrySnapshot['counts']>> {
    const p = this.deps.prisma;
    const [devices, rooms, scenes, automations, iotSchedules, users] = await Promise.all([
      p.device.count(),
      p.room.count(),
      p.scene.count(),
      p.automationRule.count(),
      p.iotSchedule.count(),
      p.user.count(),
    ]);
    return { devices, rooms, scenes, automations, iotSchedules, users };
  }

  /** Telemetría anónima; recuentos solo si el opt-in está activo. */
  async getTelemetry(): Promise<TelemetrySnapshot> {
    const enabled = await this.deps.telemetryEnabled();
    // Solo consultamos los recuentos si está activada (opt-in estricto).
    const counts = enabled ? await this.gatherCounts() : { devices: 0, rooms: 0, scenes: 0, automations: 0, iotSchedules: 0, users: 0 };
    return buildTelemetry(enabled, this.deps.version, counts);
  }

  /** Auditoría reciente **sin PII**: solo acción + fecha (ni IP ni actor). */
  private async recentAudit(): Promise<SupportBundle['recentAudit']> {
    const rows = await this.deps.prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { action: true, createdAt: true },
    });
    return rows.map((r) => ({ action: r.action, at: r.createdAt.toISOString() }));
  }

  async buildBundle(): Promise<SupportBundle> {
    const [settings, integrations, telemetry, recentAudit] = await Promise.all([
      this.deps.readSettings(),
      this.deps.integrationStore.list(),
      this.getTelemetry(),
      this.recentAudit(),
    ]);

    return {
      generatedAt: this.deps.now().toISOString(),
      version: this.deps.version,
      deployMode: this.deps.deployMode,
      nodeVersion: process.version,
      platform: `${process.platform}/${process.arch}`,
      uptimeSeconds: this.deps.uptimeSeconds(),
      driverKind: this.deps.driverKind,
      settings: sanitizeSettings(settings),
      integrations: integrations.map((i) => ({
        domain: i.domain,
        kind: i.kind,
        enabled: i.enabled,
        // `config` de `IntegrationConfigInfo` ya viene SIN secretos; `secretsSet`
        // solo lista qué claves hay puestas (nunca su valor).
        config: Object.fromEntries(
          Object.entries(i.config).map(([k, v]) => [k, String(v)]),
        ),
        secretsSet: i.secretsSet,
      })),
      metrics: this.deps.metrics(),
      telemetry,
      recentAudit,
      logsHint:
        'Los logs del agente van a stdout (journald en systemd: `journalctl -u krakenos`; Docker: `docker logs`). No se incluyen aquí para no arrastrar PII.',
    };
  }
}
