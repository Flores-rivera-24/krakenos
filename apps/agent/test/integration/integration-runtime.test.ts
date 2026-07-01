import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createSecretbox, generateSecretboxKey } from '../../src/config/secretbox.js';
import { IntegrationConfigStore } from '../../src/integrations/integration-config.store.js';
import { buildIntegrationRuntime } from '../../src/integrations/runtime.js';
import { buildTestApp } from '../helpers/app.js';

describe('IntegrationRuntime — hidratación DB/env + recarga en caliente (US-141)', () => {
  let app: FastifyInstance;
  let store: IntegrationConfigStore;

  beforeAll(async () => {
    app = await buildTestApp();
    store = new IntegrationConfigStore(app.prisma, createSecretbox(generateSecretboxKey()));
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await app.prisma.integrationConfig.deleteMany();
  });

  it('sin config guardada hidrata desde env (mock) y el handle responde', async () => {
    const rt = await buildIntegrationRuntime(app, store);
    expect(rt.driver.handle.kind).toBe('mock');
    // El handle delega en la instancia viva: un método del driver mock responde.
    await expect(rt.driver.handle.getWifi()).resolves.toBeTruthy();
  });

  it('reconfigure intercambia el driver en caliente sin re-registrar nada', async () => {
    const rt = await buildIntegrationRuntime(app, store);
    expect(rt.driver.handle.kind).toBe('mock');

    await store.save('driver', 'openwrt', {
      host: '192.168.1.1',
      username: 'root',
      password: 'x',
      sshPort: 22,
    });
    await rt.reconfigure('driver');

    // El MISMO handle (ya inyectado en las rutas) ahora apunta al driver OpenWrt.
    expect(rt.driver.handle.kind).toBe('openwrt');
  });

  it('una config guardada pero deshabilitada usa el fallback de env', async () => {
    await store.save('driver', 'openwrt', { host: '1.2.3.4', password: 'x' }, false);
    const rt = await buildIntegrationRuntime(app, store);
    expect(rt.driver.handle.kind).toBe('mock'); // ignora la config no activa
  });
});
