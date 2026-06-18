import type { QosRule } from '@krakenos/types';
import { beforeEach, describe, expect, it } from 'vitest';
import type { CommandResult, CommandRunner } from '../../src/privileged/runner.js';
import { TcQosManager } from '../../src/qos/tc.qos.js';
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
  count(prefix: string): number {
    return this.calls.filter((c) => c.join(' ').startsWith(prefix)).length;
  }
}

function makeManager(runner: FakeRunner) {
  return new TcQosManager({
    runner,
    store: new MemoryJsonStore<QosRule>(),
    interface: 'eth0',
    linkKbit: 1_000_000,
  });
}

describe('TcQosManager', () => {
  let runner: FakeRunner;

  beforeEach(() => {
    runner = new FakeRunner();
  });

  it('crea una regla y reconstruye la jerarquía HTB con clase y filtro', async () => {
    const qos = makeManager(runner);
    const rule = await qos.createRule({
      name: 'Limitar consola',
      target: '10.0.0.50',
      priority: 'low',
      downloadKbps: 20000,
    });

    expect(rule.priority).toBe('low');
    expect(runner.called('tc qdisc del dev eth0 root')).toBe(true);
    expect(runner.called('tc qdisc add dev eth0 root')).toBe(true);
    expect(runner.called('tc class add dev eth0 parent 1:1 classid 1:10')).toBe(true);
    // Objetivo con IP → filtro u32.
    expect(runner.called('tc filter add dev eth0')).toBe(true);
  });

  it('no añade filtro para objetivos sin IP (p. ej. servicio)', async () => {
    const qos = makeManager(runner);
    await qos.createRule({ name: 'Zoom', target: 'service:zoom', priority: 'high' });
    expect(runner.called('tc class add dev eth0 parent 1:1 classid 1:10')).toBe(true);
    expect(runner.count('tc filter add')).toBe(0);
  });

  it('usa la capacidad del enlace como rate cuando no hay límite', async () => {
    const qos = makeManager(runner);
    await qos.createRule({ name: 'sin límite', target: '10.0.0.9' });
    const leaf = runner.calls.find((c) => c.join(' ').startsWith('tc class add dev eth0 parent 1:1'));
    expect(leaf?.join(' ')).toContain('1000000kbit');
  });

  it('omite reglas deshabilitadas al reconstruir', async () => {
    const qos = makeManager(runner);
    const rule = await qos.createRule({ name: 'a', target: '10.0.0.1', downloadKbps: 1000 });
    runner.calls = [];
    await qos.updateRule(rule.id, { enabled: false });
    expect(runner.count('tc class add dev eth0 parent 1:1')).toBe(0);
  });

  it('actualiza (null si no existe) y elimina (idempotente)', async () => {
    const qos = makeManager(runner);
    const rule = await qos.createRule({ name: 'a', target: '10.0.0.1' });
    expect((await qos.updateRule(rule.id, { name: 'b' }))?.name).toBe('b');
    expect(await qos.updateRule('inexistente', { name: 'x' })).toBeNull();
    expect(await qos.removeRule(rule.id)).toBe(true);
    expect(await qos.removeRule(rule.id)).toBe(false);
    expect(await qos.listRules()).toHaveLength(0);
  });
});
