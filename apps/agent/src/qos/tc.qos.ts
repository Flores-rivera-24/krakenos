import { randomUUID } from 'node:crypto';
import type {
  CreateQosRuleRequest,
  QosManager,
  QosRule,
  UpdateQosRuleRequest,
} from '@krakenos/types';
import type { CommandRunner } from '../privileged/runner.js';
import type { JsonStore } from '../store/json-store.js';
import {
  isIpTarget,
  priorityToPrio,
  tcFilterIpArgs,
  tcLeafClassArgs,
  tcQdiscAddRootArgs,
  tcQdiscDelRootArgs,
  tcRootClassArgs,
} from './tc.helpers.js';

/** Clase HTB por defecto (catch-all) para el tráfico sin regla. */
const DEFAULT_CLASS = 9999;
/** Primera clase hoja; las reglas usan 10, 11, 12… */
const FIRST_LEAF = 10;

export interface TcQosOptions {
  runner: CommandRunner;
  store: JsonStore<QosRule>;
  /** Interfaz a moldear, p. ej. `eth0`. */
  interface: string;
  /** Capacidad del enlace en kbit (rate de la clase raíz y de las reglas sin límite). */
  linkKbit: number;
}

/**
 * Gestor de QoS real sobre `tc` (HTB). El `store` es la fuente de verdad de las
 * reglas; `apply()` reconstruye la jerarquía HTB de la interfaz en cada cambio.
 *
 * Esquema **baseline**: shaping de egress en una sola interfaz, con clases por
 * prioridad/límite y filtros u32 para objetivos con IP. El moldeado de subida,
 * el multi-interfaz y los objetivos por servicio quedan como refinamiento que
 * requiere verificación con hardware.
 */
export class TcQosManager implements QosManager {
  readonly kind = 'tc' as const;

  constructor(private readonly opts: TcQosOptions) {}

  /** Reconstruye la jerarquía HTB de la interfaz desde el store. */
  private async apply(): Promise<void> {
    const { runner, interface: iface, linkKbit } = this.opts;
    // Reinicia la qdisc raíz (ignora "no existe" en el primer arranque).
    await runner.run(tcQdiscDelRootArgs(iface)).catch(() => undefined);
    await runner.run(tcQdiscAddRootArgs(iface, DEFAULT_CLASS));
    await runner.run(tcRootClassArgs(iface, linkKbit));

    const rules = (await this.opts.store.list()).filter((r) => r.enabled);
    let classId = FIRST_LEAF;
    for (const rule of rules) {
      const prio = priorityToPrio(rule.priority);
      const rateKbit = rule.downloadKbps > 0 ? rule.downloadKbps : linkKbit;
      await runner.run(tcLeafClassArgs(iface, classId, rateKbit, prio));
      if (isIpTarget(rule.target)) {
        await runner.run(tcFilterIpArgs(iface, prio, rule.target, classId));
      }
      classId++;
    }
  }

  async listRules(): Promise<QosRule[]> {
    return (await this.opts.store.list()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async getRule(id: string): Promise<QosRule | null> {
    return this.opts.store.get(id);
  }

  async createRule(input: CreateQosRuleRequest): Promise<QosRule> {
    const rule: QosRule = {
      id: randomUUID(),
      name: input.name,
      target: input.target,
      priority: input.priority ?? 'normal',
      downloadKbps: input.downloadKbps ?? 0,
      uploadKbps: input.uploadKbps ?? 0,
      enabled: input.enabled ?? true,
      createdAt: new Date().toISOString(),
    };
    await this.opts.store.upsert(rule);
    await this.apply();
    return rule;
  }

  async updateRule(id: string, patch: UpdateQosRuleRequest): Promise<QosRule | null> {
    const current = await this.opts.store.get(id);
    if (!current) return null;
    const next: QosRule = { ...current, ...patch };
    await this.opts.store.upsert(next);
    await this.apply();
    return next;
  }

  async removeRule(id: string): Promise<boolean> {
    const removed = await this.opts.store.removeById(id);
    if (!removed) return false;
    await this.apply();
    return true;
  }
}
