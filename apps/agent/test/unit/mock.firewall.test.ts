import { describe, expect, it } from 'vitest';
import { MockFirewallManager } from '../../src/firewall/mock.firewall.js';

describe('MockFirewallManager', () => {
  it('arranca con reglas de ejemplo ordenadas por prioridad', async () => {
    const fw = new MockFirewallManager();
    const rules = await fw.listRules();
    expect(rules.length).toBeGreaterThanOrEqual(2);
    const priorities = rules.map((r) => r.priority);
    expect(priorities).toEqual([...priorities].sort((a, b) => a - b));
  });

  it('crea una regla aplicando los valores por defecto', async () => {
    const fw = new MockFirewallManager();
    const rule = await fw.createRule({ name: 'Bloquear cámara', action: 'deny' });
    expect(rule.id).toBeTruthy();
    expect(rule.protocol).toBe('any');
    expect(rule.source).toBeNull();
    expect(rule.port).toBeNull();
    expect(rule.enabled).toBe(true);
    expect(await fw.getRule(rule.id)).toEqual(rule);
  });

  it('actualiza una regla existente y devuelve null si no existe', async () => {
    const fw = new MockFirewallManager();
    const rule = await fw.createRule({ name: 'tmp', action: 'allow' });
    const updated = await fw.updateRule(rule.id, { enabled: false, port: 8080 });
    expect(updated?.enabled).toBe(false);
    expect(updated?.port).toBe(8080);
    expect(await fw.updateRule('inexistente', { enabled: true })).toBeNull();
  });

  it('elimina una regla y devuelve false si no existía', async () => {
    const fw = new MockFirewallManager();
    const rule = await fw.createRule({ name: 'tmp', action: 'deny' });
    expect(await fw.removeRule(rule.id)).toBe(true);
    expect(await fw.getRule(rule.id)).toBeNull();
    expect(await fw.removeRule(rule.id)).toBe(false);
  });
});
