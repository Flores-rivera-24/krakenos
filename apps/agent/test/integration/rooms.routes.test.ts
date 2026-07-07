import type { Device, Room, RoomActionResult, RoomWithState } from '@krakenos/types';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authHeader, buildTestApp, resetDb, seedUser, signAccess } from '../helpers/app.js';

/** Habitaciones y grupos de dispositivos (US-165): CRUD, asignación mixta y acción de grupo. */
describe('habitaciones (US-165)', () => {
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

  async function createRoom(name = 'Salón'): Promise<Room> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/rooms',
      headers: authHeader(adminToken),
      payload: { name, icon: 'living' },
    });
    expect(res.statusCode).toBe(201);
    return res.json() as Room;
  }

  it('CRUD de habitaciones (admin): crear, listar, editar, borrar', async () => {
    const room = await createRoom();
    expect(room.icon).toBe('living');
    expect(room.order).toBe(0);

    const list = await app.inject({
      method: 'GET',
      url: '/api/rooms',
      headers: authHeader(viewerToken), // lectura = cualquier autenticado
    });
    expect(list.statusCode).toBe(200);
    const rooms = list.json() as RoomWithState[];
    expect(rooms).toHaveLength(1);
    expect(rooms[0]).toMatchObject({ deviceCount: 0, iotCount: 0, onCount: 0 });

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/rooms/${room.id}`,
      headers: authHeader(adminToken),
      payload: { name: 'Salón principal', icon: 'dining' },
    });
    expect(patch.statusCode).toBe(200);
    expect((patch.json() as Room).name).toBe('Salón principal');

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/rooms/${room.id}`,
      headers: authHeader(adminToken),
    });
    expect(del.statusCode).toBe(204);
    const after = await app.inject({ method: 'GET', url: '/api/rooms', headers: authHeader(adminToken) });
    expect((after.json() as RoomWithState[])).toHaveLength(0);
  });

  it('asigna un dispositivo de red y un IoT a la habitación; el estado agregado los cuenta', async () => {
    const room = await createRoom();
    const device = await app.prisma.device.create({
      data: { mac: 'aa:bb:cc:dd:ee:01', ip: '192.168.1.10' },
    });

    // Dispositivo de red → habitación.
    const assignDevice = await app.inject({
      method: 'PUT',
      url: '/api/rooms/assign',
      headers: authHeader(adminToken),
      payload: { kind: 'device', ref: device.id, roomId: room.id },
    });
    expect(assignDevice.statusCode).toBe(204);
    expect((await app.prisma.device.findUnique({ where: { id: device.id } }))?.roomId).toBe(room.id);

    // IoT (mock: 'light-salon' está encendido) → habitación.
    const assignIot = await app.inject({
      method: 'PUT',
      url: '/api/rooms/assign',
      headers: authHeader(adminToken),
      payload: { kind: 'iot', ref: 'light-salon', roomId: room.id },
    });
    expect(assignIot.statusCode).toBe(204);

    const list = await app.inject({ method: 'GET', url: '/api/rooms', headers: authHeader(adminToken) });
    const [state] = list.json() as RoomWithState[];
    expect(state).toMatchObject({
      deviceCount: 1,
      iotCount: 1,
      controllableCount: 1,
      onCount: 1, // light-salon on=true en el mock
    });

    // El Device DTO refleja la habitación.
    const devList = await app.inject({
      method: 'GET',
      url: '/api/inventory/devices',
      headers: authHeader(adminToken),
    });
    expect((devList.json() as Device[])[0]?.roomId).toBe(room.id);
  });

  it('borrar la habitación desasigna sus dispositivos (SetNull) y sus IoT (Cascade)', async () => {
    const room = await createRoom();
    const device = await app.prisma.device.create({
      data: { mac: 'aa:bb:cc:dd:ee:02', ip: '192.168.1.11', roomId: room.id },
    });
    await app.prisma.iotRoomMember.create({ data: { iotDeviceId: 'plug-tv', roomId: room.id } });

    await app.inject({ method: 'DELETE', url: `/api/rooms/${room.id}`, headers: authHeader(adminToken) });

    expect((await app.prisma.device.findUnique({ where: { id: device.id } }))?.roomId).toBeNull();
    expect(await app.prisma.iotRoomMember.count()).toBe(0);
  });

  it('acción de grupo: apaga los IoT controlables y reporta el fallo parcial de un sensor', async () => {
    const room = await createRoom();
    // Un enchufe controlable + un sensor (no controlable → fallo parcial).
    for (const id of ['plug-tv', 'sensor-temp']) {
      await app.prisma.iotRoomMember.create({ data: { iotDeviceId: id, roomId: room.id } });
    }

    const res = await app.inject({
      method: 'POST',
      url: `/api/rooms/${room.id}/action`,
      headers: authHeader(adminToken),
      payload: { on: false },
    });
    expect(res.statusCode).toBe(200);
    const result = res.json() as RoomActionResult;
    expect(result.applied).toBe(1); // plug-tv
    expect(result.failed).toHaveLength(1); // sensor-temp
    expect(result.failed[0]?.deviceId).toBe('sensor-temp');
  });

  it('asignar a una habitación inexistente da 404; asignar un dispositivo inexistente da 404', async () => {
    const room = await createRoom();
    const badRoom = await app.inject({
      method: 'PUT',
      url: '/api/rooms/assign',
      headers: authHeader(adminToken),
      payload: { kind: 'iot', ref: 'light-salon', roomId: 'no-existe' },
    });
    expect(badRoom.statusCode).toBe(404);

    const badDevice = await app.inject({
      method: 'PUT',
      url: '/api/rooms/assign',
      headers: authHeader(adminToken),
      payload: { kind: 'device', ref: 'no-existe', roomId: room.id },
    });
    expect(badDevice.statusCode).toBe(404);
  });

  it('escritura bloqueada para viewer (403) y sin token (401)', async () => {
    const room = await createRoom();
    const asViewer = await app.inject({
      method: 'POST',
      url: '/api/rooms',
      headers: authHeader(viewerToken),
      payload: { name: 'X' },
    });
    expect(asViewer.statusCode).toBe(403);

    const noToken = await app.inject({
      method: 'PATCH',
      url: `/api/rooms/${room.id}`,
      payload: { name: 'X' },
    });
    expect(noToken.statusCode).toBe(401);
  });
});
