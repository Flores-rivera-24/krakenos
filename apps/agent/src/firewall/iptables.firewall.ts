import { randomUUID } from 'node:crypto';
import type {
  CreateFirewallRuleRequest,
  FirewallManager,
  FirewallRule,
  UpdateFirewallRuleRequest,
} from '@krakenos/types';
import type { CommandRunner } from '../privileged/runner.js';
import type { JsonStore } from '../store/json-store.js';
import {
  iptablesAppendArgsForRule,
  iptablesCheckLinkArgs,
  iptablesFlushArgs,
  iptablesLinkArgs,
  iptablesNewChainArgs,
} from './iptables.helpers.js';

export interface IptablesFirewallOptions {
  runner: CommandRunner;
  store: JsonStore<FirewallRule>;
  /** Cadena dedicada que gestiona KrakenOS, p. ej. `KRAKENOS`. */
  chain: string;
}

/**
 * Gestor de firewall real sobre `iptables`. El `store` es la fuente de verdad
 * de las reglas (id/prioridad/metadatos); `apply()` reconstruye una cadena
 * dedicada desde el store en cada cambio. Los comandos privilegiados pasan por
 * el `CommandRunner` (helper sudoers).
 */
export class IptablesFirewallManager implements FirewallManager {
  readonly kind = 'iptables' as const;

  constructor(private readonly opts: IptablesFirewallOptions) {}

  /** Reconstruye la cadena dedicada desde el store (reglas activas, por prioridad). */
  private async apply(): Promise<void> {
    const { runner, chain } = this.opts;
    // Asegura cadena y enlace (idempotentes: ignora "ya existe").
    await runner.run(iptablesNewChainArgs(chain)).catch(() => undefined);
    if (await runner.run(iptablesCheckLinkArgs(chain)).then(() => false).catch(() => true)) {
      await runner.run(iptablesLinkArgs(chain)).catch(() => undefined);
    }
    await runner.run(iptablesFlushArgs(chain));

    const rules = (await this.opts.store.list())
      .filter((r) => r.enabled)
      .sort((a, b) => a.priority - b.priority);
    for (const rule of rules) {
      for (const argv of iptablesAppendArgsForRule(chain, rule)) {
        await runner.run(argv);
      }
    }
  }

  async listRules(): Promise<FirewallRule[]> {
    return (await this.opts.store.list()).sort((a, b) => a.priority - b.priority);
  }

  async getRule(id: string): Promise<FirewallRule | null> {
    return this.opts.store.get(id);
  }

  async createRule(input: CreateFirewallRuleRequest): Promise<FirewallRule> {
    const existing = await this.opts.store.list();
    const priority = existing.reduce((max, r) => Math.max(max, r.priority), -1) + 1;
    const rule: FirewallRule = {
      id: randomUUID(),
      name: input.name,
      action: input.action,
      protocol: input.protocol ?? 'any',
      source: input.source ?? null,
      destination: input.destination ?? null,
      port: input.port ?? null,
      enabled: input.enabled ?? true,
      priority,
      createdAt: new Date().toISOString(),
    };
    await this.opts.store.upsert(rule);
    await this.apply();
    return rule;
  }

  async updateRule(id: string, patch: UpdateFirewallRuleRequest): Promise<FirewallRule | null> {
    const current = await this.opts.store.get(id);
    if (!current) return null;
    const next: FirewallRule = { ...current, ...patch };
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
