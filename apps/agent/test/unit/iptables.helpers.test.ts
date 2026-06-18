import type { FirewallRule } from '@krakenos/types';
import { describe, expect, it } from 'vitest';
import {
  iptablesAppendArgsForRule,
  iptablesFlushArgs,
  iptablesNewChainArgs,
  ruleTarget,
} from '../../src/firewall/iptables.helpers.js';

function rule(partial: Partial<FirewallRule>): FirewallRule {
  return {
    id: 'r1',
    name: 'regla',
    action: 'deny',
    protocol: 'any',
    source: null,
    destination: null,
    port: null,
    enabled: true,
    priority: 0,
    createdAt: '2026-06-17T00:00:00.000Z',
    ...partial,
  };
}

describe('iptables helpers', () => {
  it('mapea la acción al objetivo iptables', () => {
    expect(ruleTarget('allow')).toBe('ACCEPT');
    expect(ruleTarget('deny')).toBe('DROP');
  });

  it('construye argv de cadena', () => {
    expect(iptablesNewChainArgs('KRAKENOS')).toEqual(['iptables', '-N', 'KRAKENOS']);
    expect(iptablesFlushArgs('KRAKENOS')).toEqual(['iptables', '-F', 'KRAKENOS']);
  });

  it('traduce una regla tcp con origen y puerto', () => {
    const [argv, ...rest] = iptablesAppendArgsForRule(
      'KRAKENOS',
      rule({ action: 'deny', protocol: 'tcp', source: '10.0.0.5', port: 554 }),
    );
    expect(rest).toHaveLength(0);
    expect(argv).toEqual([
      'iptables', '-A', 'KRAKENOS',
      '-p', 'tcp',
      '-s', '10.0.0.5',
      '--dport', '554',
      '-m', 'comment', '--comment', 'krakenos:r1',
      '-j', 'DROP',
    ]);
  });

  it('omite -p cuando el protocolo es any y no hay puerto', () => {
    const argvs = iptablesAppendArgsForRule('KRAKENOS', rule({ action: 'allow', protocol: 'any' }));
    expect(argvs).toHaveLength(1);
    expect(argvs[0]).not.toContain('-p');
    expect(argvs[0]).toContain('ACCEPT');
  });

  it('emite una regla por tcp y udp cuando el protocolo es any pero hay puerto', () => {
    const argvs = iptablesAppendArgsForRule('KRAKENOS', rule({ protocol: 'any', port: 53 }));
    expect(argvs).toHaveLength(2);
    expect(argvs[0]).toContain('tcp');
    expect(argvs[1]).toContain('udp');
    expect(argvs.every((a) => a.includes('53'))).toBe(true);
  });
});
