import type { HomeEvent, PresenceState, PresenceEvent as PresenceEventDto } from '@krakenos/types';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { HomeEventBus } from '../../src/automations/event-bus.js';
import { AutomationService } from '../../src/modules/automations/automations.service.js';
import { PresenceService } from '../../src/modules/presence/presence.service.js';
import { AccessScheduleService } from '../../src/modules/access/access.service.js';
import { InventoryService } from '../../src/modules/inventory/inventory.service.js';
import { SceneService } from '../../src/modules/scenes/scenes.service.js';
import { MockDriver } from '../../src/drivers/mock.driver.js';
import { wrapDriverErrors } from '../../src/drivers/driver-error.js';
import { MockIotManager } from '../../src/iot/mock.iot.js';
import {
  authHeader,
  buildTestApp,
  eventually,
  resetDb,
  seedUser,
  signAccess,
} from '../helpers/app.js';

const T0 = new Date(2026, 6, 9, 18, 0, 0);
const min = (n: number) => new Date(T0.getTime() + n * 60_000);

/** Modos del hogar + presencia por WiFi (US-169). */
describe('presencia y modos del hogar (US-169)', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let admin: { id: string; email: string; role: 'admin' };

  beforeAll(async () => {
    app = await buildTestApp({ routes: true });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(app);
    const seeded = await seedUser(app, { role: 'admin', displayName: 'Admin' });
    admin = { id: seeded.id, email: seeded.email, role: 'admin' };
    adminToken = signAccess(app, admin);
  });

  /** Servicio de presencia con bus propio + grabadora de eventos del bus. */
  function makePresence() {
    const bus = new HomeEventBus();
    const events: HomeEvent[] = [];
    bus.subscribe((event) => {
      events.push(event);
    });
    const service = new PresenceService(app, bus);
    return { bus, events, service };
  }

  async function seedPerson(name: string, mac: string, online = false) {
    const user = await seedUser(app, {
      email: `${name.toLowerCase()}@krakenos.test`,
      role: 'member',
      displayName: name,
    });
    await app.prisma.device.create({
      data: { mac, ip: '10.0.0.50', online, ownerId: user.id },
    });
    return user;
  }

  async function currentMode(): Promise<{ mode: string; source: string }> {
    const row = await app.prisma.setting.findUnique({ where: { key: 'presence.mode' } });
    return row
      ? (JSON.parse(row.value) as { mode: string; source: string })
      : { mode: 'home', source: 'manual' };
  }

  it('la llegada es inmediata: registra el evento, publica en el bus y saca al hogar de «fuera»', async () => {
    const { events, service } = makePresence();
    const ana = await seedPerson('Ana', 'aa:bb:cc:00:00:01');
    await app.prisma.setting.create({
      data: {
        key: 'presence.mode',
        value: JSON.stringify({ mode: 'away', source: 'manual', changedAt: null }),
      },
    });

    await app.prisma.device.update({ where: { mac: 'aa:bb:cc:00:00:01' }, data: { online: true } });
    await service.onEvent({ type: 'device-online', mac: 'aa:bb:cc:00:00:01' }, T0);

    const rows = await app.prisma.presenceEvent.findMany({ where: { userId: ana.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe('arrived');
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'person-arrived', userId: ana.id, name: 'Ana' }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'mode-changed', mode: 'home', prevMode: 'away' }),
    );
    expect(await currentMode()).toMatchObject({ mode: 'home', source: 'presence' });
  });

  it('la salida espera la ventana de gracia y luego pone el hogar en «fuera»', async () => {
    const { events, service } = makePresence();
    const ana = await seedPerson('Ana', 'aa:bb:cc:00:00:02', true);
    await app.prisma.setting.upsert({
      where: { key: 'presenceGraceMin' },
      create: { key: 'presenceGraceMin', value: '10' },
      update: { value: '10' },
    });

    // Llega (fija la caché) y luego pierde la señal.
    await service.onEvent({ type: 'device-online', mac: 'aa:bb:cc:00:00:02' }, T0);
    await app.prisma.device.update({ where: { mac: 'aa:bb:cc:00:00:02' }, data: { online: false } });
    await service.onEvent({ type: 'device-offline', mac: 'aa:bb:cc:00:00:02' }, min(1));

    // Dentro de la gracia: sigue en casa, sin evento de salida.
    await service.tick(min(6));
    expect(await app.prisma.presenceEvent.count({ where: { userId: ana.id, kind: 'left' } })).toBe(0);

    // Pasada la gracia: salida registrada + persona-left + hogar a «fuera».
    await service.tick(min(12));
    expect(await app.prisma.presenceEvent.count({ where: { userId: ana.id, kind: 'left' } })).toBe(1);
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'person-left', userId: ana.id, name: 'Ana' }),
    );
    expect(await currentMode()).toMatchObject({ mode: 'away', source: 'presence' });
  });

  it('si la señal vuelve dentro de la gracia no hay salida (los móviles duermen el WiFi)', async () => {
    const { service } = makePresence();
    const ana = await seedPerson('Ana', 'aa:bb:cc:00:00:03', true);

    await service.onEvent({ type: 'device-online', mac: 'aa:bb:cc:00:00:03' }, T0);
    await app.prisma.device.update({ where: { mac: 'aa:bb:cc:00:00:03' }, data: { online: false } });
    await service.onEvent({ type: 'device-offline', mac: 'aa:bb:cc:00:00:03' }, min(1));
    await app.prisma.device.update({ where: { mac: 'aa:bb:cc:00:00:03' }, data: { online: true } });
    await service.onEvent({ type: 'device-online', mac: 'aa:bb:cc:00:00:03' }, min(3));

    await service.tick(min(20));
    const rows = await app.prisma.presenceEvent.findMany({ where: { userId: ana.id } });
    expect(rows.map((r) => r.kind)).toEqual(['arrived']); // una sola llegada, ninguna salida
  });

  it('un dispositivo sin dueño no genera presencia', async () => {
    const { events, service } = makePresence();
    await app.prisma.device.create({ data: { mac: 'aa:bb:cc:00:00:04', ip: '10.0.0.60', online: true } });
    await service.onEvent({ type: 'device-online', mac: 'aa:bb:cc:00:00:04' }, T0);
    expect(await app.prisma.presenceEvent.count()).toBe(0);
    expect(events).toHaveLength(0);
  });

  it('la ventana de gracia se acota en lectura (0 → mínimo 1 min, no salida instantánea)', async () => {
    const { service } = makePresence();
    const ana = await seedPerson('Ana', 'aa:bb:cc:00:00:05', true);
    await app.prisma.setting.upsert({
      where: { key: 'presenceGraceMin' },
      create: { key: 'presenceGraceMin', value: '0' },
      update: { value: '0' },
    });

    await service.onEvent({ type: 'device-online', mac: 'aa:bb:cc:00:00:05' }, T0);
    await app.prisma.device.update({ where: { mac: 'aa:bb:cc:00:00:05' }, data: { online: false } });
    await service.onEvent({ type: 'device-offline', mac: 'aa:bb:cc:00:00:05' }, T0);

    await service.tick(new Date(T0.getTime() + 30_000)); // 30 s < 1 min acotado
    expect(await app.prisma.presenceEvent.count({ where: { userId: ana.id, kind: 'left' } })).toBe(0);
    await service.tick(new Date(T0.getTime() + 70_000));
    expect(await app.prisma.presenceEvent.count({ where: { userId: ana.id, kind: 'left' } })).toBe(1);
  });

  it('el cambio de modo dispara las automatizaciones con trigger mode-changed', async () => {
    const { bus, service } = makePresence();
    const notifications: string[] = [];
    const driver = wrapDriverErrors(new MockDriver());
    const iot = new MockIotManager();
    // Motor real compartiendo el bus de presencia, con `notify` observable.
    void new AutomationService(app, {
      iot,
      scenes: new SceneService(app, iot),
      inventory: new InventoryService(app, driver),
      access: new AccessScheduleService(app, driver),
      bus,
      notify: async (title, body) => {
        notifications.push(`${title}: ${body}`);
      },
    });
    await app.prisma.automationRule.create({
      data: {
        name: 'Todos fuera',
        trigger: JSON.stringify({ type: 'mode-changed', mode: 'away' }),
        actions: JSON.stringify([{ type: 'notify', message: 'la casa queda vacía' }]),
      },
    });

    await service.setMode('away', 'presence', T0);
    await eventually(() => {
      expect(notifications).toContainEqual('Todos fuera: la casa queda vacía');
    });
  });

  it('POST /api/presence/mode: member cambia el modo (home.control) y queda auditado', async () => {
    const member = await seedUser(app, { email: 'm@krakenos.test', role: 'member', displayName: 'Mario' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/presence/mode',
      headers: authHeader(signAccess(app, member)),
      payload: { mode: 'night' },
    });
    expect(res.statusCode).toBe(200);
    const state = res.json() as PresenceState;
    expect(state.mode).toBe('night');
    expect(state.modeSource).toBe('manual');
    await eventually(async () => {
      const audit = await app.prisma.auditLog.findFirst({ where: { action: 'presence.mode.set' } });
      expect(audit?.detail).toBe('night');
    });
  });

  it('kid, guest y viewer no cambian el modo (403)', async () => {
    for (const role of ['kid', 'guest', 'viewer'] as const) {
      const user = await seedUser(app, { email: `${role}-p@krakenos.test`, role });
      const res = await app.inject({
        method: 'POST',
        url: '/api/presence/mode',
        headers: authHeader(signAccess(app, user)),
        payload: { mode: 'away' },
      });
      expect(res.statusCode, role).toBe(403);
    }
  });

  it('privacidad: admin ve a todas las personas; el resto solo se ve a sí mismo', async () => {
    const ana = await seedPerson('Ana', 'aa:bb:cc:00:00:06', true);
    await seedPerson('Bob', 'aa:bb:cc:00:00:07', false);

    const asAdmin = (await app
      .inject({ method: 'GET', url: '/api/presence', headers: authHeader(adminToken) })
      .then((r) => r.json())) as PresenceState;
    expect(asAdmin.people.map((p) => p.displayName).sort()).toEqual(['Ana', 'Bob']);

    const asAna = (await app
      .inject({
        method: 'GET',
        url: '/api/presence',
        headers: authHeader(signAccess(app, { id: ana.id, email: ana.email, role: 'member' })),
      })
      .then((r) => r.json())) as PresenceState;
    expect(asAna.people.map((p) => p.displayName)).toEqual(['Ana']);
    expect(asAna.people[0]).toMatchObject({ home: true, deviceCount: 1 });
  });

  it('privacidad: el timeline también se acota por rol', async () => {
    const ana = await seedPerson('Ana', 'aa:bb:cc:00:00:08');
    const bob = await seedPerson('Bob', 'aa:bb:cc:00:00:09');
    await app.prisma.presenceEvent.createMany({
      data: [
        { userId: ana.id, kind: 'arrived' },
        { userId: bob.id, kind: 'arrived' },
      ],
    });

    const asAdmin = (await app
      .inject({ method: 'GET', url: '/api/presence/timeline', headers: authHeader(adminToken) })
      .then((r) => r.json())) as PresenceEventDto[];
    expect(asAdmin).toHaveLength(2);

    const asBob = (await app
      .inject({
        method: 'GET',
        url: '/api/presence/timeline',
        headers: authHeader(signAccess(app, { id: bob.id, email: bob.email, role: 'member' })),
      })
      .then((r) => r.json())) as PresenceEventDto[];
    expect(asBob).toHaveLength(1);
    expect(asBob[0]?.displayName).toBe('Bob');
  });

  it('un ajuste presence.mode corrupto degrada al modo por defecto (patrón US-63)', async () => {
    await app.prisma.setting.upsert({
      where: { key: 'presence.mode' },
      create: { key: 'presence.mode', value: '{corrupto' },
      update: { value: '{corrupto' },
    });
    const res = (await app
      .inject({ method: 'GET', url: '/api/presence', headers: authHeader(adminToken) })
      .then((r) => r.json())) as PresenceState;
    expect(res.mode).toBe('home');
    expect(res.modeSource).toBe('manual');
  });

  it('reconcile corrige el timeline tras el arranque sin publicar en el bus', async () => {
    const { events, service } = makePresence();
    const ana = await seedPerson('Ana', 'aa:bb:cc:00:00:10', false);
    // El último evento dice "en casa", pero sus dispositivos están offline
    // (salió mientras el agente no corría).
    await app.prisma.presenceEvent.create({ data: { userId: ana.id, kind: 'arrived' } });

    await service.reconcile();

    const rows = await app.prisma.presenceEvent.findMany({
      where: { userId: ana.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(rows.map((r) => r.kind)).toEqual(['arrived', 'left']);
    expect(events).toHaveLength(0); // sin automatizaciones atrasadas al arrancar
  });

  it('los triggers de presencia validan en el borde: mode-changed exige mode', async () => {
    const bad = await app.inject({
      method: 'POST',
      url: '/api/automations',
      headers: authHeader(adminToken),
      payload: {
        name: 'X',
        trigger: { type: 'mode-changed' },
        actions: [{ type: 'notify', message: 'hola' }],
      },
    });
    expect(bad.statusCode).toBe(400);

    const ok = await app.inject({
      method: 'POST',
      url: '/api/automations',
      headers: authHeader(adminToken),
      payload: {
        name: 'Alguien llega',
        trigger: { type: 'person-arrived' },
        actions: [{ type: 'notify', message: 'hola' }],
      },
    });
    expect(ok.statusCode).toBe(201);
  });
});
