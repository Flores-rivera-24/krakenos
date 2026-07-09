import type { IotManager, Scene, SceneAction, SceneRunResult } from '@krakenos/types';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authHeader, buildTestApp, resetDb, seedUser, signAccess } from '../helpers/app.js';

/** Escenas de un toque (US-166): CRUD, ejecución best-effort y captura de estado. */
describe('escenas (US-166)', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let viewerToken: string;

  beforeAll(async () => {
    app = await buildTestApp({ routes: true });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(app);
    adminToken = signAccess(app, await seedUser(app, { role: 'admin' }));
    viewerToken = signAccess(app, await seedUser(app, { email: 'v@krakenos.test', role: 'viewer' }));
  });

  async function createScene(actions: SceneAction[]): Promise<Scene> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/scenes',
      headers: authHeader(adminToken),
      payload: { name: 'Buenas noches', icon: 'night', actions },
    });
    expect(res.statusCode).toBe(201);
    return res.json() as Scene;
  }

  it('CRUD de escenas: crear, listar, editar, borrar', async () => {
    const scene = await createScene([{ deviceId: 'light-salon', on: false }]);
    expect(scene.icon).toBe('night');
    expect(scene.actions).toHaveLength(1);

    const list = await app.inject({ method: 'GET', url: '/api/scenes', headers: authHeader(viewerToken) });
    expect((list.json() as Scene[])).toHaveLength(1);

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/scenes/${scene.id}`,
      headers: authHeader(adminToken),
      payload: { name: 'Noche', actions: [{ deviceId: 'light-salon', on: false, brightness: 10 }] },
    });
    expect(patch.statusCode).toBe(200);
    expect((patch.json() as Scene).actions[0]?.brightness).toBe(10);

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/scenes/${scene.id}`,
      headers: authHeader(adminToken),
    });
    expect(del.statusCode).toBe(204);
  });

  it('ejecuta la escena: aplica los IoT controlables y reporta el fallo parcial', async () => {
    // light-salon (controlable) + sensor-temp (no controlable → fallo).
    const scene = await createScene([
      { deviceId: 'light-salon', on: false },
      { deviceId: 'sensor-temp', on: true },
    ]);

    const res = await app.inject({
      method: 'POST',
      url: `/api/scenes/${scene.id}/run`,
      headers: authHeader(adminToken),
    });
    expect(res.statusCode).toBe(200);
    const result = res.json() as SceneRunResult;
    expect(result.applied).toBe(1);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.deviceId).toBe('sensor-temp');
  });

  it('captura el estado actual de dispositivos como acciones (ignora sensores)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/scenes/capture',
      headers: authHeader(adminToken),
      payload: { deviceIds: ['light-salon', 'sensor-temp', 'no-existe'] },
    });
    expect(res.statusCode).toBe(200);
    const actions = res.json() as SceneAction[];
    // Solo light-salon aporta acción (el sensor no es controlable; 'no-existe' no está).
    expect(actions).toHaveLength(1);
    expect(actions[0]?.deviceId).toBe('light-salon');
    // Captura el estado on/off actual (boolean) y el brillo de la luz.
    expect(typeof actions[0]?.on).toBe('boolean');
    expect(typeof actions[0]?.brightness).toBe('number');
  });

  it('la captura hace un solo listDevices, sin un getDevice por id (US-204)', async () => {
    const { SceneService } = await import('../../src/modules/scenes/scenes.service.js');
    const { MockIotManager } = await import('../../src/iot/mock.iot.js');
    const inner = new MockIotManager();
    let listCalls = 0;
    let getCalls = 0;
    const spied = {
      listDevices: async () => {
        listCalls++;
        return inner.listDevices();
      },
      getDevice: async (id: string) => {
        getCalls++;
        return inner.getDevice(id);
      },
      setState: async () => {
        throw new Error('no aplica');
      },
    } as unknown as IotManager;

    const service = new SceneService(app, spied);
    const actions = await service.captureState(['light-salon', 'sensor-temp', 'a', 'b', 'c']);
    expect(actions.map((a) => a.deviceId)).toEqual(['light-salon']);
    expect(listCalls).toBe(1);
    expect(getCalls).toBe(0);
  });

  it('la captura rechaza más de 50 ids (cota anti-amplificación, US-204)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/scenes/capture',
      headers: authHeader(adminToken),
      payload: { deviceIds: Array.from({ length: 51 }, (_, i) => `d-${i}`) },
    });
    expect(res.statusCode).toBe(400);
  });

  it('run/CRUD bloqueado para viewer (403) y sin token (401); 404 si no existe', async () => {
    const asViewer = await app.inject({
      method: 'POST',
      url: '/api/scenes',
      headers: authHeader(viewerToken),
      payload: { name: 'X', actions: [] },
    });
    expect(asViewer.statusCode).toBe(403);

    const noToken = await app.inject({ method: 'POST', url: '/api/scenes/x/run' });
    expect(noToken.statusCode).toBe(401);

    const missing = await app.inject({
      method: 'POST',
      url: '/api/scenes/no-existe/run',
      headers: authHeader(adminToken),
    });
    expect(missing.statusCode).toBe(404);
  });
});
