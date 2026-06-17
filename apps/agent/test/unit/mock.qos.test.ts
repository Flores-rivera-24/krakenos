import { describe, expect, it } from 'vitest';
import { MockQosManager } from '../../src/qos/mock.qos.js';

describe('MockQosManager', () => {
  it('arranca con reglas de ejemplo', async () => {
    const qos = new MockQosManager();
    const rules = await qos.listRules();
    expect(rules.length).toBeGreaterThanOrEqual(1);
  });

  it('crea una regla aplicando los valores por defecto', async () => {
    const qos = new MockQosManager();
    const rule = await qos.createRule({ name: 'Trabajo', target: '10.0.0.20' });
    expect(rule.id).toBeTruthy();
    expect(rule.priority).toBe('normal');
    expect(rule.downloadKbps).toBe(0);
    expect(rule.uploadKbps).toBe(0);
    expect(rule.enabled).toBe(true);
    expect(await qos.getRule(rule.id)).toEqual(rule);
  });

  it('actualiza una regla y devuelve null si no existe', async () => {
    const qos = new MockQosManager();
    const rule = await qos.createRule({ name: 'tmp', target: 'x', priority: 'low' });
    const updated = await qos.updateRule(rule.id, { priority: 'high', downloadKbps: 50_000 });
    expect(updated?.priority).toBe('high');
    expect(updated?.downloadKbps).toBe(50_000);
    expect(await qos.updateRule('inexistente', { enabled: false })).toBeNull();
  });

  it('elimina una regla y devuelve false si no existía', async () => {
    const qos = new MockQosManager();
    const rule = await qos.createRule({ name: 'tmp', target: 'x' });
    expect(await qos.removeRule(rule.id)).toBe(true);
    expect(await qos.getRule(rule.id)).toBeNull();
    expect(await qos.removeRule(rule.id)).toBe(false);
  });
});
