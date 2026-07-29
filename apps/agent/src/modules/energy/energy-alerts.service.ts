import type {
  CreateEnergyAlertRuleRequest,
  EnergyAlertRule,
  UpdateEnergyAlertRuleRequest,
} from '@krakenos/types';
import { ENERGY_ALERT_METRICS } from '@krakenos/types';
import type { FastifyInstance } from 'fastify';
import type { HomeEventBus } from '../../automations/event-bus.js';
import type { IotManager } from '@krakenos/types';
import { evaluate, initialState, type RuleState } from './energy-alerts.eval.js';
import { createTickLoop, type TickLoop } from '../../system/tick-loop.js';

/** Convierte una fila de Prisma a la vista de dominio, saneando el enum. */
function toRule(row: {
  id: string;
  deviceId: string;
  metric: string;
  threshold: number;
  sustainMinutes: number;
  enabled: boolean;
  createdAt: Date;
}): EnergyAlertRule {
  const metric = (ENERGY_ALERT_METRICS as readonly string[]).includes(row.metric)
    ? (row.metric as EnergyAlertRule['metric'])
    : 'sustained-power';
  return {
    id: row.id,
    deviceId: row.deviceId,
    metric,
    threshold: row.threshold,
    sustainMinutes: row.sustainMinutes,
    enabled: row.enabled,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Alertas de consumo eléctrico (US-183). Evalúa periódicamente las reglas de
 * umbral por dispositivo; al cruzarse una, publica un evento `energy-threshold`
 * (disparador de automatización, US-167) y lo audita como `energy.threshold`, que
 * el despacho multicanal (US-180) entrega por el canal preferido.
 *
 * La decisión (histéresis, sostenido, cooldown, una vez/día) vive en el evaluador
 * puro `energy-alerts.eval.ts`; aquí solo se mantiene el estado por regla y se
 * alimentan las magnitudes observadas (potencia actual / energía del día).
 */
export class EnergyAlertService {
  private loop: TickLoop | null = null;
  private readonly state = new Map<string, RuleState>();

  constructor(
    private readonly app: FastifyInstance,
    private readonly iot: IotManager,
    private readonly bus: HomeEventBus,
    private readonly intervalMs = 60_000,
    private readonly rollupMs = 60_000,
  ) {}

  async list(): Promise<EnergyAlertRule[]> {
    const rows = await this.app.prisma.energyAlertRule.findMany({ orderBy: { createdAt: 'asc' } });
    return rows.map(toRule);
  }

  async create(input: CreateEnergyAlertRuleRequest): Promise<EnergyAlertRule> {
    const row = await this.app.prisma.energyAlertRule.create({
      data: {
        deviceId: input.deviceId,
        metric: input.metric,
        threshold: input.threshold,
        sustainMinutes: input.sustainMinutes ?? 5,
        enabled: input.enabled ?? true,
      },
    });
    return toRule(row);
  }

  async update(id: string, patch: UpdateEnergyAlertRuleRequest): Promise<EnergyAlertRule | null> {
    const existing = await this.app.prisma.energyAlertRule.findUnique({ where: { id } });
    if (!existing) return null;
    const row = await this.app.prisma.energyAlertRule.update({
      where: { id },
      data: {
        metric: patch.metric ?? existing.metric,
        threshold: patch.threshold ?? existing.threshold,
        sustainMinutes: patch.sustainMinutes ?? existing.sustainMinutes,
        enabled: patch.enabled ?? existing.enabled,
      },
    });
    // Un cambio de umbral/metric invalida el estado acumulado de esa regla.
    this.state.delete(id);
    return toRule(row);
  }

  async remove(id: string): Promise<boolean> {
    const res = await this.app.prisma.energyAlertRule.deleteMany({ where: { id } });
    this.state.delete(id);
    return res.count > 0;
  }

  /** Energía (Wh) acumulada hoy por dispositivo, para las reglas `daily-energy`. */
  private async todayEnergyByDevice(now: Date, deviceIds: string[]): Promise<Map<string, number>> {
    if (deviceIds.length === 0) return new Map();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const rows = await this.app.prisma.energySample.findMany({
      where: { deviceId: { in: deviceIds }, timestamp: { gte: startOfDay } },
      select: { deviceId: true, powerW: true },
    });
    const rollupHours = this.rollupMs / 1000 / 3600;
    const out = new Map<string, number>();
    for (const r of rows) {
      out.set(r.deviceId, (out.get(r.deviceId) ?? 0) + r.powerW * rollupHours);
    }
    return out;
  }

  /**
   * Un barrido: evalúa cada regla habilitada contra la magnitud observada y
   * dispara las que cruzan. `now` inyectable para los tests.
   */
  async tick(now: Date = new Date()): Promise<void> {
    const rules = (await this.app.prisma.energyAlertRule.findMany({ where: { enabled: true } })).map(
      toRule,
    );
    if (rules.length === 0) return;

    const devices = await this.iot.listDevices();
    const powerById = new Map(devices.map((d) => [d.id, d.powerW ?? null]));

    const dailyIds = rules.filter((r) => r.metric === 'daily-energy').map((r) => r.deviceId);
    const dailyEnergy = await this.todayEnergyByDevice(now, dailyIds);

    for (const rule of rules) {
      const value =
        rule.metric === 'daily-energy'
          ? (dailyEnergy.get(rule.deviceId) ?? 0)
          : (powerById.get(rule.deviceId) ?? null);
      // Un dispositivo sin medición de potencia no puede disparar `sustained-power`.
      if (value === null) continue;

      const prev = this.state.get(rule.id) ?? initialState();
      const { fire, state } = evaluate(prev, rule, value, now);
      this.state.set(rule.id, state);
      if (fire) this.fire(rule, value);
    }
  }

  /** Publica el evento al bus y lo audita para el despacho multicanal (US-180). */
  private fire(rule: EnergyAlertRule, value: number): void {
    this.bus.publish({
      type: 'energy-threshold',
      deviceId: rule.deviceId,
      metric: rule.metric,
      value: Math.round(value * 10) / 10,
      threshold: rule.threshold,
    });
    const unit = rule.metric === 'sustained-power' ? 'W' : 'Wh';
    this.app.audit({
      action: 'energy.threshold',
      detail: `${rule.deviceId} ${Math.round(value)}${unit} > ${rule.threshold}${unit}`,
    });
    this.app.log.info(`[energy] alerta de consumo: ${rule.deviceId} ${Math.round(value)}${unit}`);
  }

  start(): void {
    if (this.loop) return;
    this.loop = createTickLoop({
      intervalMs: this.intervalMs,
      tick: () => this.tick(),
      onError: (err) =>
        this.app.log.warn({ err }, '[energy] la evaluación de alertas falló; se omite este ciclo'),
      onSkip: () =>
        this.app.log.warn('[energy] la evaluación anterior sigue en curso; se salta este ciclo'),
    });
    this.loop.start();
  }

  stop(): void {
    this.loop?.stop();
    this.loop = null;
  }
}
