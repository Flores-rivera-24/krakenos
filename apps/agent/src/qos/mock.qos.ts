import { randomUUID } from 'node:crypto';
import type {
  CreateQosRuleRequest,
  QosManager,
  QosRule,
  UpdateQosRuleRequest,
} from '@krakenos/types';

/** Error de dominio de QoS con código estable. */
export class QosError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Gestor de QoS en memoria para desarrollo. Simula reglas de priorización y
 * límite de ancho de banda sin tocar `tc`. Sembrado con reglas de ejemplo.
 */
export class MockQosManager implements QosManager {
  readonly kind = 'mock' as const;
  private readonly rules = new Map<string, QosRule>();
  private seq = 0;

  constructor() {
    const seed: Omit<QosRule, 'id' | 'createdAt'>[] = [
      {
        name: 'Prioridad videollamadas',
        priority: 'high',
        target: 'service:zoom',
        downloadKbps: 0,
        uploadKbps: 0,
        enabled: true,
      },
      {
        name: 'Limitar consola',
        priority: 'low',
        target: '10.0.0.50',
        downloadKbps: 20_000,
        uploadKbps: 5_000,
        enabled: true,
      },
    ];
    for (const r of seed) this.insert(r);
  }

  private insert(input: Omit<QosRule, 'id' | 'createdAt'>): QosRule {
    const rule: QosRule = {
      ...input,
      id: randomUUID(),
      // Timestamp determinista y creciente, sin depender del reloj.
      createdAt: new Date(++this.seq * 1000).toISOString(),
    };
    this.rules.set(rule.id, rule);
    return rule;
  }

  async listRules(): Promise<QosRule[]> {
    return [...this.rules.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async getRule(id: string): Promise<QosRule | null> {
    return this.rules.get(id) ?? null;
  }

  async createRule(input: CreateQosRuleRequest): Promise<QosRule> {
    return this.insert({
      name: input.name,
      target: input.target,
      priority: input.priority ?? 'normal',
      downloadKbps: input.downloadKbps ?? 0,
      uploadKbps: input.uploadKbps ?? 0,
      enabled: input.enabled ?? true,
    });
  }

  async updateRule(id: string, patch: UpdateQosRuleRequest): Promise<QosRule | null> {
    const current = this.rules.get(id);
    if (!current) return null;
    const next: QosRule = { ...current, ...patch };
    this.rules.set(id, next);
    return next;
  }

  async removeRule(id: string): Promise<boolean> {
    return this.rules.delete(id);
  }
}
