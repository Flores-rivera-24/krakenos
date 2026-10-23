import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSecretbox, generateSecretboxKey } from '../../src/config/secretbox.js';
import { IntegrationConfigStore } from '../../src/integrations/integration-config.store.js';
import { buildIntegrationRuntime } from '../../src/integrations/runtime.js';
import { buildTestApp } from '../helpers/app.js';

const hoisted = vi.hoisted(() => ({
  fwStart: vi.fn<() => Promise<void>>(),
  qosStart: vi.fn<() => Promise<void>>(),
}));

vi.mock('../../src/firewall/index.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  createFirewallManager: () => ({ kind: 'iptables', start: hoisted.fwStart }),
}));
vi.mock('../../src/qos/index.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  createQosManager: () => ({ kind: 'tc', start: hoisted.qosStart }),
}));

describe('IntegrationRuntime: el cortafuegos y el QoS se reaplican al crear y al recargar', () => {
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
    hoisted.fwStart.mockReset().mockResolvedValue(undefined);
    hoisted.qosStart.mockReset().mockResolvedValue(undefined);
  });

  it('llama a start() una vez al crear y otra al recargar', async () => {
    const rt = await buildIntegrationRuntime(app, store);
    expect(hoisted.fwStart).toHaveBeenCalledTimes(1);
    expect(hoisted.qosStart).toHaveBeenCalledTimes(1);

    await rt.reconfigure('firewall');
    expect(hoisted.fwStart).toHaveBeenCalledTimes(2);
    expect(hoisted.qosStart).toHaveBeenCalledTimes(1);

    await rt.reconfigure('qos');
    expect(hoisted.qosStart).toHaveBeenCalledTimes(2);
  });

  it('un start() que rechaza no tumba la creación ni la recarga', async () => {
    hoisted.fwStart.mockRejectedValue(new Error('helper caído'));
    hoisted.qosStart.mockRejectedValue(new Error('helper caído'));

    const rt = await buildIntegrationRuntime(app, store);
    await expect(rt.reconfigure('firewall')).resolves.toEqual({ fallback: false });
    await expect(rt.reconfigure('qos')).resolves.toEqual({ fallback: false });
    expect(rt.firewall.handle.kind).toBe('iptables');
  });

  it('un start() que lanza síncrono tampoco tumba nada y se registra', async () => {
    hoisted.fwStart.mockImplementation(() => {
      throw new Error('fallo síncrono');
    });
    const logSpy = vi.spyOn(app.log, 'error');
    await expect(buildIntegrationRuntime(app, store)).resolves.toBeDefined();
    await vi.waitFor(() =>
      expect(logSpy.mock.calls.some((c) => String(c[0]).includes('fallo síncrono'))).toBe(true),
    );
    logSpy.mockRestore();
  });
});
