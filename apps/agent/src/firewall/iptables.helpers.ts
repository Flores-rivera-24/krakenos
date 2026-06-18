import type { FirewallAction, FirewallRule } from '@krakenos/types';

/** Objetivo iptables (`-j`) según la acción de la regla. */
export function ruleTarget(action: FirewallAction): 'ACCEPT' | 'DROP' {
  return action === 'allow' ? 'ACCEPT' : 'DROP';
}

export const iptablesNewChainArgs = (chain: string): string[] => ['iptables', '-N', chain];

export const iptablesFlushArgs = (chain: string): string[] => ['iptables', '-F', chain];

/** Enlaza la cadena propia desde FORWARD (idempotente con `-C` antes de `-A`). */
export const iptablesCheckLinkArgs = (chain: string): string[] => [
  'iptables',
  '-C',
  'FORWARD',
  '-j',
  chain,
];
export const iptablesLinkArgs = (chain: string): string[] => ['iptables', '-A', 'FORWARD', '-j', chain];

/**
 * Traduce una regla a uno o más comandos `iptables -A <chain> …`. Devuelve
 * varios argv cuando el protocolo es `any` pero hay puerto (iptables exige
 * `-p` para `--dport`, así que se emite una regla por tcp y udp).
 */
export function iptablesAppendArgsForRule(chain: string, rule: FirewallRule): string[][] {
  const protocols: (string | null)[] =
    rule.protocol === 'any' ? (rule.port != null ? ['tcp', 'udp'] : [null]) : [rule.protocol];

  return protocols.map((proto) => {
    const args = ['iptables', '-A', chain];
    if (proto) args.push('-p', proto);
    if (rule.source) args.push('-s', rule.source);
    if (rule.destination) args.push('-d', rule.destination);
    if (rule.port != null) args.push('--dport', String(rule.port));
    // Etiqueta cada regla con su id para trazabilidad en `iptables -L`.
    args.push('-m', 'comment', '--comment', `krakenos:${rule.id}`);
    args.push('-j', ruleTarget(rule.action));
    return args;
  });
}
