import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockIotManager } from '../../src/iot/mock.iot.js';
import { MockMatterBridgeStack } from '../../src/iot/matter-bridge/stack.js';
import { MatterBridgeService } from '../../src/modules/matter-bridge/matter-bridge.service.js';
import { buildTestApp } from '../helpers/app.js';

describe('MatterBridgeService (US-171)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await app.prisma.setting.deleteMany({ where: { key: 'matter.bridge' } });
    await app.prisma.auditLog.deleteMany();
  });

  function make() {
    const iot = new MockIotManager();
    const stack = new MockMatterBridgeStack();
    return { iot, stack, svc: new MatterBridgeService(app, iot, stack) };
  }

  it('nace desactivado (opt-in): reconcile no arranca el stack', async () => {
    const { stack, svc } = make();
    await svc.reconcile();
    expect(stack.running()).toBe(false);
    const state = await svc.getState();
    expect(state.enabled).toBe(false);
    expect(state.running).toBe(false);
    expect(state.qrCode).toBeNull();
  });

  it('lista como candidatos solo los aparatos mapeables (sin sensores)', async () => {
    const { svc } = make();
    const state = await svc.getState();
    expect(state.candidates.length).toBeGreaterThan(0);
    expect(state.candidates.some((c) => c.deviceId.startsWith('sensor-'))).toBe(false);
    expect(state.candidates.every((c) => !c.exposed)).toBe(true);
  });

  it('activar + exponer dispositivos arranca el stack con esos endpoints y da QR', async () => {
    const { stack, svc } = make();
    const state = await svc.update({ enabled: true, exposedDeviceIds: ['plug-tv', 'light-salon'] });
    expect(stack.running()).toBe(true);
    expect(state.running).toBe(true);
    expect(state.endpoints.map((e) => e.deviceId).sort()).toEqual(['light-salon', 'plug-tv']);
    expect(state.qrCode).toContain('MT:');
    expect(state.qrDataUrl).toMatch(/^data:image\/png/);
    // El stack publica exactamente esos endpoints.
    expect(stack.publishedEndpoints()).toHaveLength(2);
  });

  it('un comando Matter entrante se aplica al IoT y se audita (origen matter)', async () => {
    const { iot, stack, svc } = make();
    await svc.update({ enabled: true, exposedDeviceIds: ['plug-tv'] });
    // La TV nace encendida; el comando la apaga.
    stack.emit('plug-tv', { on: false });
    await vi.waitFor(async () => {
      const dev = await iot.getDevice('plug-tv');
      expect(dev?.on).toBe(false);
    });
    await vi.waitFor(async () => {
      const audit = await app.prisma.auditLog.findFirst({ where: { action: 'matter.command' } });
      expect(audit?.detail).toContain('origen:matter');
    });
  });

  it('ignora comandos para dispositivos no expuestos (superficie acotada)', async () => {
    const { iot, stack, svc } = make();
    await svc.update({ enabled: true, exposedDeviceIds: ['plug-tv'] });
    const before = await iot.getDevice('light-salon');
    stack.emit('light-salon', { on: false }); // no expuesto
    // Espera un tick y comprueba que no cambió.
    await new Promise((r) => setTimeout(r, 20));
    const after = await iot.getDevice('light-salon');
    expect(after?.on).toBe(before?.on);
  });

  it('desactivar detiene el stack', async () => {
    const { stack, svc } = make();
    await svc.update({ enabled: true, exposedDeviceIds: ['plug-tv'] });
    expect(stack.running()).toBe(true);
    const state = await svc.update({ enabled: false });
    expect(stack.running()).toBe(false);
    expect(state.running).toBe(false);
  });

  it('refleja el comisionado del stack', async () => {
    const { stack, svc } = make();
    await svc.update({ enabled: true, exposedDeviceIds: ['plug-tv'] });
    expect((await svc.getState()).commissioned).toBe(false);
    stack.simulateCommission();
    const state = await svc.getState();
    expect(state.commissioned).toBe(true);
    expect(state.fabricCount).toBe(1);
  });

  it('config corrupta → puente desactivado (defensivo)', async () => {
    const { svc } = make();
    await app.prisma.setting.create({ data: { key: 'matter.bridge', value: '{no json' } });
    const state = await svc.getState();
    expect(state.enabled).toBe(false);
  });
});
