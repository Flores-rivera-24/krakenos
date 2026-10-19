import type {
  CreateFirewallRuleRequest,
  FirewallManager,
  FirewallRule,
  UpdateFirewallRuleRequest,
} from '@krakenos/types';
import { DomainNotConfiguredError } from '../integrations/not-configured.js';

/** Cortafuegos «sin configurar» (`FIREWALL_KIND=none`): sin reglas; escribir es un 409. */
export class NoneFirewallManager implements FirewallManager {
  readonly kind = 'none' as const;
  readonly notConfigured = true as const;

  async listRules(): Promise<FirewallRule[]> {
    return [];
  }

  async getRule(_id: string): Promise<FirewallRule | null> {
    return null;
  }

  async createRule(_input: CreateFirewallRuleRequest): Promise<FirewallRule> {
    throw new DomainNotConfiguredError('firewall');
  }

  async updateRule(_id: string, _patch: UpdateFirewallRuleRequest): Promise<FirewallRule | null> {
    throw new DomainNotConfiguredError('firewall');
  }

  async removeRule(_id: string): Promise<boolean> {
    throw new DomainNotConfiguredError('firewall');
  }
}
