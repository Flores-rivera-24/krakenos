import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { IotIdMigrationService } from '../../src/modules/iot/id-migration.service.js';
import { CompositeIotManager } from '../../src/iot/composite.iot.js';
import { MockIotManager } from '../../src/iot/mock.iot.js';
import { buildTestApp, resetDb, seedUser } from '../helpers/app.js';

/**
 * US-243, sobre la DB real. El invariante que se ata es el de la historia entera:
 * **añadir un segundo ecosistema no puede vaciarle la casa al usuario.**
 *
 * Antes, `createIotManager` devolvía el manager directo con un backend y lo
 * envolvía en `CompositeIotManager` con dos — y el composite prefija. Los ids
 * viven crudos y **sin FK** en siete sitios, así que «empiezo con Hue y luego
 * añado los Tapo» dejaba escenas, habitaciones, horarios, favoritos, energía y los
 * sensores de la alarma apuntando a ids que ya no existían. Sin un solo error.
 */
describe('IotIdMigrationService (US-243)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(app);
  });

  /**
   * Manager como el de producción: envuelto SIEMPRE en el composite, también con
   * un solo backend (US-243). Pasar el mock pelado daría ids sin prefijo, que es
   * justo lo que el arreglo eliminó.
   */
  function managerDe(...prefijos: string[]) {
    return new CompositeIotManager(
      prefijos.map((prefix) => ({ prefix, manager: new MockIotManager() })),
    );
  }

  /** Siembra los SIETE sitios que persisten un id IoT, con el id crudo `light-salon`. */
  async function seedTodoConIdCrudo(): Promise<{ userId: string; roomId: string }> {
    const user = await seedUser(app, { role: 'admin' });
    const room = await app.prisma.room.create({ data: { name: 'Salón' } });
    await app.prisma.iotRoomMember.create({
      data: { iotDeviceId: 'light-salon', roomId: room.id },
    });
    await app.prisma.favorite.create({
      data: { userId: user.id, kind: 'iot', ref: 'light-salon', order: 0 },
    });
    await app.prisma.scene.create({
      data: {
        name: 'Noche',
        actions: JSON.stringify([{ deviceId: 'light-salon', on: false }]),
      },
    });
    await app.prisma.iotSchedule.create({
      data: {
        name: 'Apagar',
        days: '[1]',
        time: JSON.stringify({ kind: 'fixed', minute: 1320 }),
        target: JSON.stringify({ type: 'device', deviceId: 'light-salon', on: false }),
      },
    });
    await app.prisma.energySample.create({
      data: { deviceId: 'light-salon', powerW: 10 },
    });
    await app.prisma.energyAlertRule.create({
      data: { deviceId: 'light-salon', metric: 'sustained-power', threshold: 100 },
    });
    await app.prisma.setting.create({
      data: {
        key: 'alarm.config',
        value: JSON.stringify({ sensorDeviceIds: ['light-salon'], entryDelaySec: 30 }),
      },
    });
    return { userId: user.id, roomId: room.id };
  }

  it('reescribe los SIETE sitios al formato con prefijo', async () => {
    const { userId } = await seedTodoConIdCrudo();

    await new IotIdMigrationService({
      app,
      iot: managerDe('mock'),
      kinds: ['mock'],
    }).run();

    const member = await app.prisma.iotRoomMember.findFirst();
    expect(member?.iotDeviceId).toBe('mock:light-salon');

    const fav = await app.prisma.favorite.findFirst({ where: { userId, kind: 'iot' } });
    expect(fav?.ref).toBe('mock:light-salon');

    const scene = await app.prisma.scene.findFirst();
    expect(JSON.parse(scene!.actions)[0].deviceId).toBe('mock:light-salon');

    const schedule = await app.prisma.iotSchedule.findFirst();
    expect(JSON.parse(schedule!.target).deviceId).toBe('mock:light-salon');

    const sample = await app.prisma.energySample.findFirst();
    expect(sample?.deviceId).toBe('mock:light-salon');

    const rule = await app.prisma.energyAlertRule.findFirst();
    expect(rule?.deviceId).toBe('mock:light-salon');

    const alarm = await app.prisma.setting.findUnique({ where: { key: 'alarm.config' } });
    expect(JSON.parse(alarm!.value).sensorDeviceIds).toEqual(['mock:light-salon']);
  });

  it('conserva el resto de los datos: no es un borrado con otro nombre', async () => {
    await seedTodoConIdCrudo();
    await new IotIdMigrationService({ app, iot: managerDe('mock'), kinds: ['mock'] }).run();

    // Los conteos no cambian — la migración reapunta, no destruye.
    expect(await app.prisma.iotRoomMember.count()).toBe(1);
    expect(await app.prisma.favorite.count()).toBe(1);
    expect(await app.prisma.scene.count()).toBe(1);
    expect(await app.prisma.energySample.count()).toBe(1);
    // Y los campos vecinos siguen intactos.
    const alarm = await app.prisma.setting.findUnique({ where: { key: 'alarm.config' } });
    expect(JSON.parse(alarm!.value).entryDelaySec).toBe(30);
    const scene = await app.prisma.scene.findFirst();
    expect(JSON.parse(scene!.actions)[0].on).toBe(false);
  });

  it('es idempotente: correrla dos veces no vuelve a prefijar', async () => {
    await seedTodoConIdCrudo();
    const svc = new IotIdMigrationService({ app, iot: managerDe('mock'), kinds: ['mock'] });
    await svc.run();
    await svc.run();

    const member = await app.prisma.iotRoomMember.findFirst();
    // `mock:mock:light-salon` sería el desastre clásico de una migración sin guard.
    expect(member?.iotDeviceId).toBe('mock:light-salon');
  });

  it('no vuelve a mirar en cada arranque: deja la marca puesta', async () => {
    await seedTodoConIdCrudo();
    await new IotIdMigrationService({ app, iot: managerDe('mock'), kinds: ['mock'] }).run();
    const done = await app.prisma.setting.findUnique({ where: { key: 'iot.idsPrefixed.v1' } });
    expect(done?.value).toBe('true');
  });

  it('una instalación nueva se marca hecha sin tocar nada', async () => {
    const plan = await new IotIdMigrationService({
      app,
      iot: managerDe('mock'),
      kinds: ['mock'],
    }).run();
    expect(plan).toBeNull();
    const done = await app.prisma.setting.findUnique({ where: { key: 'iot.idsPrefixed.v1' } });
    expect(done?.value).toBe('true');
  });

  it('un backend que no responde NO impide arreglar el caso de un solo backend', async () => {
    // El bridge Hue está apagado justo al arrancar: la regla del backend único
    // sigue resolviendo, porque no necesita ver el aparato.
    await seedTodoConIdCrudo();
    const caido = {
      kind: 'hue' as const,
      listDevices: () => Promise.reject(new Error('bridge apagado')),
      getDevice: () => Promise.resolve(null),
      setState: () => Promise.reject(new Error('bridge apagado')),
    };
    await new IotIdMigrationService({
      app,
      iot: caido as unknown as CompositeIotManager,
      kinds: ['hue'],
    }).run();

    const member = await app.prisma.iotRoomMember.findFirst();
    expect(member?.iotDeviceId).toBe('hue:light-salon');
  });

  it('con dos backends y un id que no casa con nada, lo deja y lo reporta', async () => {
    await seedTodoConIdCrudo();
    const plan = await new IotIdMigrationService({
      app,
      iot: managerDe('hue', 'govee'),
      kinds: ['hue', 'govee'], // dos backends: `light-salon` es ambiguo
    }).run();

    expect(plan?.unresolved).toContain('light-salon');
    // Y NO se ha inventado un prefijo: la escena sigue rota **y visible**, que es
    // mejor que apuntar a un aparato que no es.
    const member = await app.prisma.iotRoomMember.findFirst();
    expect(member?.iotDeviceId).toBe('light-salon');
  });
});
