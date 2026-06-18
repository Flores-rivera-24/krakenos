import type { FirewallRule } from '@krakenos/types';
import { beforeEach, describe, expect, it } from 'vitest';
import { IptablesFirewallManager } from '../../src/firewall/iptables.firewall.js';
import type { CommandResult, CommandRunner } from '../../src/privileged/runner.js';
import { MemoryJsonStore } from '../../src/store/json-store.js';

class FakeRunner implements CommandRunner {
  calls: string[][] = [];
  async run(argv: string[]): Promise<CommandResult> {
    this.calls.push(argv);
    return { stdout: '', stderr: '', code: 0 };
  }
  called(prefix: string): boolean {
    return this.calls.some((c) => c.join(' ').startsWith(prefix));
  }
  appends(): string[][] {
    return this.calls.filter((c) => c[1] === '-A' && c.includes('--comment'));
  }
}

function makeManager(runner: FakeRunner) {
  return new IptablesFirewallManager({
    runner,
    store: new MemoryJsonStore<FirewallRule>(),
    chain: 'KRAKENOS',
  });
}

describe('IptablesFirewallManager', () => {
  let runner: FakeRunner;

  beforeEach(() => {
    runner = new FakeRunner();
  });

  it('crea una regla, asigna prioridad y reconstruye la cadena', async () => {
    const fw = makeManager(runner);
    const rule = await fw.createRule({ name: 'block cam', action: 'deny', protocol: 'tcp', port: 554 });

    expect(rule.priority).toBe(0);
    expect(rule.enabled).toBe(true);
    expect(runner.called('iptables -F KRAKENOS')).toBe(true);

    const append = runner.appends()[0]!;
    expect(append).toContain('DROP');
    expect(append).toContain('554');
    expect(append.join(' ')).toContain(`krakenos:${rule.id}`);
  });

  it('asigna prioridades incrementales', async () => {
    const fw = makeManager(runner);
    const a = await fw.createRule({ name: 'a', action: 'deny' });
    const b = await fw.createRule({ name: 'b', action: 'allow' });
    expect(a.priority).toBe(0);
    expect(b.priority).toBe(1);
    expect((await fw.listRules()).map((r) => r.name)).toEqual(['a', 'b']);
  });

  it('no aplica reglas deshabilitadas al reconstruir', async () => {
    const fw = makeManager(runner);
    const rule = await fw.createRule({ name: 'a', action: 'deny' });
    runner.calls = [];
    await fw.updateRule(rule.id, { enabled: false });
    expect(runner.called('iptables -F KRAKENOS')).toBe(true);
    expect(runner.appends()).toHaveLength(0); // deshabilitada → no se añade
  });

  it('emite dos reglas (tcp/udp) para protocolo any con puerto', async () => {
    const fw = makeManager(runner);
    await fw.createRule({ name: 'dns', action: 'allow', port: 53 });
    expect(runner.appends()).toHaveLength(2);
  });

  it('actualiza (404 → null) y elimina (idempotente)', async () => {
    const fw = makeManager(runner);
    const rule = await fw.createRule({ name: 'a', action: 'deny' });
    expect((await fw.updateRule(rule.id, { name: 'b' }))?.name).toBe('b');
    expect(await fw.updateRule('inexistente', { name: 'x' })).toBeNull();
    expect(await fw.removeRule(rule.id)).toBe(true);
    expect(await fw.removeRule(rule.id)).toBe(false);
    expect(await fw.listRules()).toHaveLength(0);
  });
});
