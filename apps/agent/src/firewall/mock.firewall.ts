import { randomUUID } from 'node:crypto';
import type {
  CreateFirewallRuleRequest,
  FirewallManager,
  FirewallRule,
  UpdateFirewallRuleRequest,
} from '@krakenos/types';

/** Error de dominio del firewall con código estable. */
export class FirewallError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Gestor de firewall en memoria para desarrollo. Simula reglas allow/deny
 * sin tocar `iptables`. Sembrado con reglas de ejemplo para que la UI no
 * arranque vacía.
 */
export class MockFirewallManager implements FirewallManager {
  readonly kind = 'mock' as const;
  private readonly rules = new Map<string, FirewallRule>();
  private seq = 0;

  constructor() {
    const seed: Omit<FirewallRule, 'id' | 'createdAt' | 'priority'>[] = [
      {
        name: 'Bloquear IoT a internet',
        action: 'deny',
        protocol: 'any',
        source: '10.0.30.0/24',
        destination: null,
        port: null,
        enabled: true,
      },
      {
        name: 'Permitir DNS interno',
        action: 'allow',
        protocol: 'udp',
        source: null,
        destination: '10.0.0.1',
        port: 53,
        enabled: true,
      },
      {
        name: 'Bloquear SMB hacia la WAN',
        action: 'deny',
        protocol: 'tcp',
        source: null,
        destination: null,
        port: 445,
        enabled: false,
      },
    ];
    for (const r of seed) this.insert(r);
  }

  private insert(input: Omit<FirewallRule, 'id' | 'createdAt' | 'priority'>): FirewallRule {
    const rule: FirewallRule = {
      ...input,
      id: randomUUID(),
      priority: this.seq++,
      // Timestamps deterministas y crecientes sin depender del reloj.
      createdAt: new Date(this.seq * 1000).toISOString(),
    };
    this.rules.set(rule.id, rule);
    return rule;
  }

  async listRules(): Promise<FirewallRule[]> {
    return [...this.rules.values()].sort((a, b) => a.priority - b.priority);
  }

  async getRule(id: string): Promise<FirewallRule | null> {
    return this.rules.get(id) ?? null;
  }

  async createRule(input: CreateFirewallRuleRequest): Promise<FirewallRule> {
    return this.insert({
      name: input.name,
      action: input.action,
      protocol: input.protocol ?? 'any',
      source: input.source ?? null,
      destination: input.destination ?? null,
      port: input.port ?? null,
      enabled: input.enabled ?? true,
    });
  }

  async updateRule(id: string, patch: UpdateFirewallRuleRequest): Promise<FirewallRule | null> {
    const current = this.rules.get(id);
    if (!current) return null;
    const next: FirewallRule = {
      ...current,
      ...patch,
    };
    this.rules.set(id, next);
    return next;
  }

  async removeRule(id: string): Promise<boolean> {
    return this.rules.delete(id);
  }
}
