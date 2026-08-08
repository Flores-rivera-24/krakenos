import type {
  AutomationRule,
  AutomationRun,
  AutomationTrigger,
  HardwareDriver,
} from '@krakenos/types';
import { AUTOMATION_TRIGGER_TYPES } from '@krakenos/types';

type AutomationTriggerType = AutomationTrigger['type'];
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { HomeEventBus } from '../../src/automations/event-bus.js';
import { MockIotManager } from '../../src/iot/mock.iot.js';
import { AccessScheduleService } from '../../src/modules/access/access.service.js';
import { AutomationService } from '../../src/modules/automations/automations.service.js';
import { InventoryService } from '../../src/modules/inventory/inventory.service.js';
import { SceneService } from '../../src/modules/scenes/scenes.service.js';
import { authHeader, buildTestApp, eventually, resetDb, seedUser, signAccess } from '../helpers/app.js';

/** Automatizaciones «si X entonces Y» (US-167): CRUD + motor. */
describe('automatizaciones (US-167)', () => {
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

  /** Servicio con dependencias controlables para probar el motor sin timers. */
  function makeService(over: {
    driverCalls?: string[];
    notifications?: { title: string; body: string }[];
  } = {}) {
    const driver = {
      blockDevice: async (mac: string) => {
        over.driverCalls?.push(`block:${mac}`);
      },
      unblockDevice: async (mac: string) => {
        over.driverCalls?.push(`unblock:${mac}`);
      },
    } as unknown as HardwareDriver;
    const iot = new MockIotManager();
    const bus = new HomeEventBus();
    const service = new AutomationService(app, {
      iot,
      scenes: new SceneService(app, iot),
      inventory: new InventoryService(app, driver),
      access: new AccessScheduleService(app, driver),
      bus,
      notify: async (title, body) => {
        over.notifications?.push({ title, body });
      },
    });
    return { service, bus, iot };
  }

  it('CRUD: crear, listar, editar, borrar (admin)', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/automations',
      headers: authHeader(adminToken),
      payload: {
        name: 'Luz al llegar',
        trigger: { type: 'device-online', mac: 'aa:bb:cc:dd:ee:ff' },
        condition: { fromMinute: 19 * 60, toMinute: 7 * 60 },
        actions: [{ type: 'iot-set', deviceId: 'light-salon', on: true }],
        cooldownSec: 300,
      },
    });
    expect(create.statusCode).toBe(201);
    const rule = create.json() as AutomationRule;
    expect(rule.trigger).toEqual({ type: 'device-online', mac: 'aa:bb:cc:dd:ee:ff' });
    expect(rule.cooldownSec).toBe(300);

    const list = await app.inject({
      method: 'GET',
      url: '/api/automations',
      headers: authHeader(adminToken),
    });
    expect((list.json() as AutomationRule[])).toHaveLength(1);

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/automations/${rule.id}`,
      headers: authHeader(adminToken),
      payload: { enabled: false, condition: null },
    });
    expect(patch.statusCode).toBe(200);
    const updated = patch.json() as AutomationRule;
    expect(updated.enabled).toBe(false);
    expect(updated.condition).toBeUndefined();

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/automations/${rule.id}`,
      headers: authHeader(adminToken),
    });
    expect(del.statusCode).toBe(204);
  });

  it('authz: escritura solo admin (403 viewer, 401 sin token); 404 si no existe', async () => {
    const asViewer = await app.inject({
      method: 'POST',
      url: '/api/automations',
      headers: authHeader(viewerToken),
      payload: { name: 'X', trigger: { type: 'device-new' }, actions: [{ type: 'notify', message: 'x' }] },
    });
    expect(asViewer.statusCode).toBe(403);

    const noToken = await app.inject({ method: 'GET', url: '/api/automations' });
    expect(noToken.statusCode).toBe(401);

    const missing = await app.inject({
      method: 'PATCH',
      url: '/api/automations/nope',
      headers: authHeader(adminToken),
      payload: { enabled: false },
    });
    expect(missing.statusCode).toBe(404);
  });

  it('valida el shape por tipo: disparador sin su campo requerido → 400', async () => {
    const post = (payload: unknown) =>
      app.inject({ method: 'POST', url: '/api/automations', headers: authHeader(adminToken), payload });

    // device-online exige mac; notify exige message; sensor-threshold exige op/value.
    const noMac = await post({
      name: 'X',
      trigger: { type: 'device-online' },
      actions: [{ type: 'notify', message: 'x' }],
    });
    expect(noMac.statusCode).toBe(400);
    const noMessage = await post({
      name: 'X',
      trigger: { type: 'device-new' },
      actions: [{ type: 'notify' }],
    });
    expect(noMessage.statusCode).toBe(400);
    const noOp = await post({
      name: 'X',
      trigger: { type: 'sensor-threshold', deviceId: 's' },
      actions: [{ type: 'notify', message: 'x' }],
    });
    expect(noOp.statusCode).toBe(400);
  });

  it('dispositivo desconocido → lo bloquea y avisa (objetivo implícito del evento)', async () => {
    const driverCalls: string[] = [];
    const notifications: { title: string; body: string }[] = [];
    const { service, bus } = makeService({ driverCalls, notifications });

    const mac = 'aa:bb:cc:dd:ee:01';
    await app.prisma.device.create({ data: { mac, ip: '192.168.1.50' } });
    await service.create({
      name: 'Intruso fuera',
      trigger: { type: 'device-new' },
      actions: [{ type: 'device-block' }, { type: 'notify', message: 'Dispositivo nuevo bloqueado' }],
    });

    bus.publish({ type: 'device-new', mac });

    await eventually(async () => {
      expect(driverCalls).toContain(`block:${mac}`);
      expect(notifications).toEqual([{ title: 'Intruso fuera', body: 'Dispositivo nuevo bloqueado' }]);
      const runs = await service.listRuns();
      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({ ok: true, event: `dispositivo desconocido ${mac}` });
    });
  });

  it('una acción que falla no aborta el resto ni tumba el motor (best-effort + log)', async () => {
    const notifications: { title: string; body: string }[] = [];
    const { service, bus } = makeService({ notifications });

    await service.create({
      name: 'Con fallo',
      trigger: { type: 'device-new' },
      actions: [
        { type: 'iot-set', deviceId: 'no-existe', on: true },
        { type: 'notify', message: 'sigo vivo' },
      ],
    });

    bus.publish({ type: 'device-new', mac: 'aa:bb:cc:dd:ee:02' });

    await eventually(async () => {
      expect(notifications).toHaveLength(1); // la 2ª acción se ejecutó igualmente
      const runs = await service.listRuns();
      expect(runs).toHaveLength(1);
      expect(runs[0]?.ok).toBe(false);
      expect(runs[0]?.detail).toContain('iot-set');
    });
  });

  it('cooldown: el mismo evento repetido no re-dispara dentro de la ventana', async () => {
    const notifications: { title: string; body: string }[] = [];
    const { service } = makeService({ notifications });
    await service.create({
      name: 'Con cooldown',
      trigger: { type: 'device-new' },
      actions: [{ type: 'notify', message: 'x' }],
      cooldownSec: 60,
    });

    const now = new Date();
    await service.onEvent({ type: 'device-new', mac: 'aa' }, now);
    await service.onEvent({ type: 'device-new', mac: 'bb' }, new Date(now.getTime() + 10_000));
    expect(notifications).toHaveLength(1);

    // Pasada la ventana vuelve a disparar.
    await service.onEvent({ type: 'device-new', mac: 'cc' }, new Date(now.getTime() + 61_000));
    expect(notifications).toHaveLength(2);
  });

  it('la condición de ventana horaria bloquea el disparo fuera de horario', async () => {
    const notifications: { title: string; body: string }[] = [];
    const { service } = makeService({ notifications });
    await service.create({
      name: 'Solo de noche',
      trigger: { type: 'device-new' },
      condition: { fromMinute: 22 * 60, toMinute: 7 * 60 },
      actions: [{ type: 'notify', message: 'x' }],
    });

    await service.onEvent({ type: 'device-new', mac: 'aa' }, new Date(2026, 6, 8, 12, 0));
    expect(notifications).toHaveLength(0);
    await service.onEvent({ type: 'device-new', mac: 'bb' }, new Date(2026, 6, 8, 23, 0));
    expect(notifications).toHaveLength(1);
  });

  it('disparador de hora: el barrido dispara al cruzar el minuto (y no en el 1er tick)', async () => {
    const { service, iot } = makeService();
    await service.create({
      name: 'Apagar a las 23',
      trigger: { type: 'time', days: [0, 1, 2, 3, 4, 5, 6], minute: 23 * 60 },
      actions: [{ type: 'iot-set', deviceId: 'light-salon', on: false }],
    });

    await service.tick(new Date(2026, 6, 8, 22, 59)); // primer tick: fija la base
    await service.tick(new Date(2026, 6, 8, 23, 0)); // cruza → dispara
    expect((await iot.getDevice('light-salon'))?.on).toBe(false);

    const runs = await service.listRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]?.event).toBe('hora programada');
  });

  it('umbral de sensor: dispara al cruzar y ejecuta una escena', async () => {
    const { service, iot } = makeService();
    const scene = await new SceneService(app, iot).create({
      name: 'Ventilar',
      actions: [{ deviceId: 'plug-cafetera', on: true }],
    });
    const rule = await service.create({
      name: 'Calor',
      trigger: { type: 'sensor-threshold', deviceId: 'sensor-temp', op: 'gt', value: 30 },
      actions: [{ type: 'scene-run', sceneId: scene.id }],
    });

    await service.onEvent({ type: 'sensor-reading', deviceId: 'sensor-temp', value: 32, prevValue: 28 });
    const runs = await service.listRuns(rule.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.ok).toBe(true);

    // Lectura sostenida por encima → no re-dispara (sin cruce).
    await service.onEvent(
      { type: 'sensor-reading', deviceId: 'sensor-temp', value: 33, prevValue: 32 },
      new Date(Date.now() + 120_000),
    );
    expect(await service.listRuns(rule.id)).toHaveLength(1);
  });

  it('anti-bucle: un evento causado por la propia regla no la re-dispara', async () => {
    const notifications: { title: string; body: string }[] = [];
    const { service } = makeService({ notifications });
    const rule = await service.create({
      name: 'Self',
      trigger: { type: 'iot-on', deviceId: 'light-salon' },
      actions: [{ type: 'notify', message: 'x' }],
      cooldownSec: 5,
    });

    await service.onEvent({ type: 'iot-on', deviceId: 'light-salon', origin: `automation:${rule.id}` });
    expect(notifications).toHaveLength(0);
    await service.onEvent({ type: 'iot-on', deviceId: 'light-salon' });
    expect(notifications).toHaveLength(1);
  });

  it('una regla corrupta en DB se degrada a deshabilitada sin tumbar el GET (patrón US-63)', async () => {
    await app.prisma.automationRule.create({
      data: { name: 'corrupta', enabled: true, trigger: 'no-json{', actions: 'tampoco}' },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/automations',
      headers: authHeader(adminToken),
    });
    expect(res.statusCode).toBe(200);
    const rules = res.json() as AutomationRule[];
    expect(rules).toHaveLength(1);
    expect(rules[0]?.enabled).toBe(false);
  });

  it('el log de ejecuciones se lee autenticado y filtra por regla', async () => {
    const { service } = makeService({ notifications: [] });
    const rule = await service.create({
      name: 'R',
      trigger: { type: 'device-new' },
      actions: [{ type: 'notify', message: 'x' }],
    });
    await service.onEvent({ type: 'device-new', mac: 'aa' });

    const res = await app.inject({
      method: 'GET',
      url: `/api/automations/runs?ruleId=${rule.id}`,
      headers: authHeader(viewerToken),
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as AutomationRun[])).toHaveLength(1);
  });

  /**
   * El esquema del borde tenía la lista de tipos de disparador **copiada a
   * mano** y se quedó corta: `weather-threshold` llegó al contrato, al motor y
   * al asistente, pero no al enum, así que la regla del tiempo se ofrecía y se
   * rechazaba con un 400 que el usuario no podía resolver. El motor sí estaba
   * probado —en unitarias, sobre la función pura— y el borde no lo probaba
   * nadie. Esto recorre **todos** los tipos del contrato contra la ruta real.
   */
  describe('el borde acepta todos los disparadores del contrato', () => {
    const EJEMPLOS: Record<AutomationTriggerType, AutomationTrigger> = {
      'device-new': { type: 'device-new' },
      'device-online': { type: 'device-online', mac: 'aa:bb:cc:dd:ee:ff' },
      'device-offline': { type: 'device-offline', mac: 'aa:bb:cc:dd:ee:ff' },
      'iot-on': { type: 'iot-on', deviceId: 'mock:1' },
      'iot-off': { type: 'iot-off', deviceId: 'mock:1' },
      'sensor-threshold': { type: 'sensor-threshold', deviceId: 'mock:1', op: 'gt', value: 20 },
      'energy-threshold': { type: 'energy-threshold' },
      'motion-detected': { type: 'motion-detected' },
      'weather-threshold': {
        type: 'weather-threshold',
        metric: 'temperature',
        op: 'lt',
        value: 5,
      },
      time: { type: 'time', days: [1], minute: 600 },
      sun: { type: 'sun', event: 'sunset', offsetMin: -15, days: [1, 2] },
      'person-arrived': { type: 'person-arrived' },
      'person-left': { type: 'person-left' },
      'mode-changed': { type: 'mode-changed', mode: 'away' },
    };

    // Guard de tamaño: si el contrato gana un disparador y el mapa no, esto se
    // pone rojo aquí en vez de dejar la lista corta otra vez.
    it('el mapa de ejemplos cubre el contrato entero', () => {
      expect(Object.keys(EJEMPLOS).sort()).toEqual([...AUTOMATION_TRIGGER_TYPES].sort());
      expect(AUTOMATION_TRIGGER_TYPES.length).toBeGreaterThan(10);
    });

    for (const [tipo, trigger] of Object.entries(EJEMPLOS)) {
      it(`acepta y devuelve intacto el disparador «${tipo}»`, async () => {
        const res = await app.inject({
          method: 'POST',
          url: '/api/automations',
          headers: authHeader(adminToken),
          payload: {
            name: `R ${tipo}`,
            trigger,
            actions: [{ type: 'notify', message: 'x' }],
          },
        });
        expect(res.statusCode).toBe(201);
        // Se compara el disparador COMPLETO: `additionalProperties:false` en la
        // respuesta poda campos en silencio (US-238), así que un 201 solo no
        // prueba que el dato haya sobrevivido el viaje.
        expect((res.json() as AutomationRule).trigger).toEqual(trigger);
      });
    }
  });

  describe('disparador solar (US-256)', () => {
    it('rechaza un desfase fuera de rango', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/automations',
        headers: authHeader(adminToken),
        payload: {
          name: 'R',
          trigger: { type: 'sun', event: 'sunset', offsetMin: 5000, days: [1] },
          actions: [{ type: 'notify', message: 'x' }],
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it('exige suceso, desfase y días', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/automations',
        headers: authHeader(adminToken),
        payload: {
          name: 'R',
          trigger: { type: 'sun', event: 'sunset' },
          actions: [{ type: 'notify', message: 'x' }],
        },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  it('la API de horarios IoT ya no existe: la absorbieron las rutinas (US-256)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/iot-schedules',
      headers: authHeader(adminToken),
    });
    expect(res.statusCode).toBe(404);
  });
});
