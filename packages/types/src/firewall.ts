import type { Id, IsoDateTime } from './common.js';

/** Implementaciones de gestor de firewall disponibles. */
export type FirewallKind = 'mock' | 'iptables';

/** Qué hace la regla con el tráfico que coincide. */
export type FirewallAction = 'allow' | 'deny';

/** Protocolo al que aplica la regla. */
export type FirewallProtocol = 'tcp' | 'udp' | 'any';

/**
 * Regla de firewall: filtra tráfico por origen/destino, protocolo y puerto.
 * Las reglas se evalúan por `priority` ascendente (menor = antes).
 */
export interface FirewallRule {
  id: Id;
  /** Descripción legible asignada por el usuario. */
  name: string;
  action: FirewallAction;
  protocol: FirewallProtocol;
  /** Origen (IP, CIDR o MAC); `null` = cualquiera. */
  source: string | null;
  /** Destino (IP, CIDR o host); `null` = cualquiera. */
  destination: string | null;
  /** Puerto destino (1-65535); `null` = cualquiera. */
  port: number | null;
  enabled: boolean;
  /** Orden de evaluación (menor = mayor prioridad). */
  priority: number;
  createdAt: IsoDateTime;
}

export interface CreateFirewallRuleRequest {
  name: string;
  action: FirewallAction;
  /** Por defecto `'any'`. */
  protocol?: FirewallProtocol;
  source?: string | null;
  destination?: string | null;
  port?: number | null;
  /** Por defecto `true`. */
  enabled?: boolean;
}

/** Cambios parciales aplicables a una regla existente. */
export interface UpdateFirewallRuleRequest {
  name?: string;
  action?: FirewallAction;
  protocol?: FirewallProtocol;
  source?: string | null;
  destination?: string | null;
  port?: number | null;
  enabled?: boolean;
  priority?: number;
}

/**
 * Gestor de firewall intercambiable. La implementación real (`iptables`)
 * delega las operaciones privilegiadas a un helper vía sudoers; `mock`
 * simula las reglas en memoria.
 */
export interface FirewallManager {
  listRules(): Promise<FirewallRule[]>;
  getRule(id: Id): Promise<FirewallRule | null>;
  createRule(input: CreateFirewallRuleRequest): Promise<FirewallRule>;
  /** Aplica cambios; devuelve `null` si la regla no existe. */
  updateRule(id: Id, patch: UpdateFirewallRuleRequest): Promise<FirewallRule | null>;
  /** Elimina una regla; devuelve `false` si no existía. */
  removeRule(id: Id): Promise<boolean>;
}
