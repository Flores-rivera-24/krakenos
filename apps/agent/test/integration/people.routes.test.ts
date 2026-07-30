import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  authHeader,
  buildTestApp,
  eventually,
  resetDb,
  seedUser,
  signAccess,
} from '../helpers/app.js';

/**
 * Personas del hogar (US-240): el control parental por persona. Lo que se ata
 * aquí es el **fan-out** (una acción → todos sus dispositivos), la privacidad por
 * rol y que la hora de dormir sea una sola ventana por persona replicada, no una
 * lista que se acumula.
 */
describe('rutas de personas (US-240)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp({ routes: true });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(app);
  });

  /** Crea una persona con `count` dispositivos a su nombre. */
  async function seedPerson(
    email: string,
    role: 'admin' | 'member' | 'kid' | 'viewer',
    macs: string[],
  ) {
    const user = await seedUser(app, { role, email, displayName: email.split('@')[0] });
    for (const [i, mac] of macs.entries()) {
      await app.prisma.device.create({
        data: { mac, ip: `10.0.0.${i + 10}`, label: `${email}-${i}`, ownerId: user.id },
      });
    }
    return user;
  }

  describe('lectura', () => {
    it('exige autenticación', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/people' });
      expect(res.statusCode).toBe(401);
    });

    it('agrupa los dispositivos por persona y marca los huérfanos', async () => {
      const admin = await seedPerson('admin@test', 'admin', ['aa:00:00:00:00:01']);
      await seedPerson('marta@test', 'kid', ['bb:00:00:00:00:01', 'bb:00:00:00:00:02']);
      await app.prisma.device.create({ data: { mac: 'cc:00:00:00:00:01', ip: '10.0.0.99' } });

      const res = await app.inject({
        method: 'GET',
        url: '/api/people',
        headers: authHeader(signAccess(app, admin)),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.fullHome).toBe(true);
      expect(body.unassignedDevices).toBe(1);

      const marta = body.people.find((p: { name: string }) => p.name === 'marta');
      expect(marta.devices).toHaveLength(2);
      // Conteos asimétricos: el admin tiene 1 y Marta 2.
      const adminRow = body.people.find((p: { name: string }) => p.name === 'admin');
      expect(adminRow.devices).toHaveLength(1);
      // Y el grupo sin dueño existe, con su dispositivo dentro.
      const orphans = body.people.find((p: { userId: string | null }) => p.userId === null);
      expect(orphans.devices).toHaveLength(1);
    });

    it('un kid solo se ve a sí mismo y no cuenta huérfanos ajenos', async () => {
      await seedPerson('admin@test', 'admin', ['aa:00:00:00:00:01']);
      const marta = await seedPerson('marta@test', 'kid', ['bb:00:00:00:00:01']);
      await app.prisma.device.create({ data: { mac: 'cc:00:00:00:00:01', ip: '10.0.0.99' } });

      const res = await app.inject({
        method: 'GET',
        url: '/api/people',
        headers: authHeader(signAccess(app, marta)),
      });
      const body = res.json();
      expect(body.fullHome).toBe(false);
      expect(body.people).toHaveLength(1);
      expect(body.people[0].userId).toBe(marta.id);
      expect(body.unassignedDevices).toBe(0);
    });

    it('no publica la MAC de los dispositivos', async () => {
      const admin = await seedPerson('admin@test', 'admin', ['aa:bb:cc:dd:ee:ff']);
      const res = await app.inject({
        method: 'GET',
        url: '/api/people',
        headers: authHeader(signAccess(app, admin)),
      });
      expect(res.body).not.toContain('aa:bb:cc:dd:ee:ff');
    });
  });

  describe('pausa por persona', () => {
    it('pausa TODOS los dispositivos de la persona con una sola llamada', async () => {
      const admin = await seedUser(app, { role: 'admin', email: 'a@test' });
      const marta = await seedPerson('marta@test', 'kid', [
        'bb:00:00:00:00:01',
        'bb:00:00:00:00:02',
        'bb:00:00:00:00:03',
      ]);

      const res = await app.inject({
        method: 'POST',
        url: `/api/people/${marta.id}/pause`,
        headers: authHeader(signAccess(app, admin)),
        payload: { minutes: 30 },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().applied).toBe(3);
      expect(res.json().failed).toBe(0);
      expect(res.json().pausedUntil).toBeTruthy();

      const paused = await app.prisma.device.count({
        where: { ownerId: marta.id, pausedUntil: { gt: new Date() } },
      });
      expect(paused).toBe(3);
    });

    it('no toca los dispositivos de otra persona', async () => {
      const admin = await seedUser(app, { role: 'admin', email: 'a@test' });
      const marta = await seedPerson('marta@test', 'kid', ['bb:00:00:00:00:01']);
      const luis = await seedPerson('luis@test', 'member', ['cc:00:00:00:00:01']);

      await app.inject({
        method: 'POST',
        url: `/api/people/${marta.id}/pause`,
        headers: authHeader(signAccess(app, admin)),
        payload: { minutes: 30 },
      });

      const suyos = await app.prisma.device.findMany({ where: { ownerId: luis.id } });
      expect(suyos.every((d) => d.pausedUntil === null)).toBe(true);
    });

    it('reanuda a todos', async () => {
      const admin = await seedUser(app, { role: 'admin', email: 'a@test' });
      const marta = await seedPerson('marta@test', 'kid', [
        'bb:00:00:00:00:01',
        'bb:00:00:00:00:02',
      ]);
      const auth = authHeader(signAccess(app, admin));

      await app.inject({
        method: 'POST',
        url: `/api/people/${marta.id}/pause`,
        headers: auth,
        payload: { minutes: 30 },
      });
      const res = await app.inject({
        method: 'POST',
        url: `/api/people/${marta.id}/resume`,
        headers: auth,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().applied).toBe(2);

      const sigueEnPausa = await app.prisma.device.count({
        where: { ownerId: marta.id, pausedUntil: { not: null } },
      });
      expect(sigueEnPausa).toBe(0);
    });

    it('404 con una persona que no existe (en vez de «0 aplicados»)', async () => {
      const admin = await seedUser(app, { role: 'admin', email: 'a@test' });
      const res = await app.inject({
        method: 'POST',
        url: '/api/people/no-existe/pause',
        headers: authHeader(signAccess(app, admin)),
        payload: { minutes: 30 },
      });
      expect(res.statusCode).toBe(404);
    });

    it('audita la acción con el parcial real', async () => {
      const admin = await seedUser(app, { role: 'admin', email: 'a@test' });
      const marta = await seedPerson('marta@test', 'kid', ['bb:00:00:00:00:01']);
      await app.inject({
        method: 'POST',
        url: `/api/people/${marta.id}/pause`,
        headers: authHeader(signAccess(app, admin)),
        payload: { minutes: 30 },
      });
      // La auditoría es fire-and-forget con reintento (US-85).
      await eventually(async () => {
        const log = await app.prisma.auditLog.findFirst({ where: { action: 'people.pause' } });
        expect(log?.detail).toContain('1/1');
      });
    });
  });

  describe('hora de dormir', () => {
    it('crea una ventana por cada dispositivo de la persona', async () => {
      const admin = await seedUser(app, { role: 'admin', email: 'a@test' });
      const marta = await seedPerson('marta@test', 'kid', [
        'bb:00:00:00:00:01',
        'bb:00:00:00:00:02',
      ]);

      const res = await app.inject({
        method: 'PUT',
        url: `/api/people/${marta.id}/bedtime`,
        headers: authHeader(signAccess(app, admin)),
        payload: { days: [1, 2, 3, 4, 5], startMinute: 1320, endMinute: 420 },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().applied).toBe(2);

      const rows = await app.prisma.accessSchedule.findMany({ where: { personId: marta.id } });
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.startMinute === 1320 && r.endMinute === 420)).toBe(true);
    });

    it('reemplaza la ventana anterior en vez de acumular horarios', async () => {
      const admin = await seedUser(app, { role: 'admin', email: 'a@test' });
      const marta = await seedPerson('marta@test', 'kid', ['bb:00:00:00:00:01']);
      const auth = authHeader(signAccess(app, admin));

      await app.inject({
        method: 'PUT',
        url: `/api/people/${marta.id}/bedtime`,
        headers: auth,
        payload: { days: [1], startMinute: 1320, endMinute: 420 },
      });
      await app.inject({
        method: 'PUT',
        url: `/api/people/${marta.id}/bedtime`,
        headers: auth,
        payload: { days: [1, 2], startMinute: 1380, endMinute: 400 },
      });

      const rows = await app.prisma.accessSchedule.findMany({ where: { personId: marta.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.startMinute).toBe(1380);
    });

    it('la devuelve en la vista con a cuántos aparatos se aplica', async () => {
      const admin = await seedUser(app, { role: 'admin', email: 'a@test' });
      const marta = await seedPerson('marta@test', 'kid', [
        'bb:00:00:00:00:01',
        'bb:00:00:00:00:02',
      ]);
      const auth = authHeader(signAccess(app, admin));

      await app.inject({
        method: 'PUT',
        url: `/api/people/${marta.id}/bedtime`,
        headers: auth,
        payload: { days: [1], startMinute: 1320, endMinute: 420 },
      });
      const res = await app.inject({ method: 'GET', url: '/api/people', headers: auth });
      const row = res.json().people.find((p: { userId: string }) => p.userId === marta.id);
      expect(row.bedtime.appliedTo).toBe(2);
      expect(row.bedtime.startMinute).toBe(1320);
      // Y una persona sin hora de dormir la trae en `null`, no ausente: la
      // serialización de Fastify debe conservar el `null`.
      const adminRow = res.json().people.find((p: { userId: string }) => p.userId === admin.id);
      expect(adminRow.bedtime).toBeNull();
    });

    it('no toca los horarios sueltos del dispositivo', async () => {
      const admin = await seedUser(app, { role: 'admin', email: 'a@test' });
      const marta = await seedPerson('marta@test', 'kid', ['bb:00:00:00:00:01']);
      const auth = authHeader(signAccess(app, admin));
      await app.prisma.accessSchedule.create({
        data: {
          name: 'Deberes',
          mac: 'bb:00:00:00:00:01',
          days: '[1]',
          startMinute: 900,
          endMinute: 1000,
        },
      });

      await app.inject({
        method: 'PUT',
        url: `/api/people/${marta.id}/bedtime`,
        headers: auth,
        payload: { days: [1], startMinute: 1320, endMinute: 420 },
      });
      await app.inject({
        method: 'DELETE',
        url: `/api/people/${marta.id}/bedtime`,
        headers: auth,
      });

      const sueltos = await app.prisma.accessSchedule.findMany({ where: { personId: null } });
      expect(sueltos).toHaveLength(1);
      expect(sueltos[0]?.name).toBe('Deberes');
    });

    it('la borra al eliminar a la persona (no queda cortando internet)', async () => {
      const admin = await seedUser(app, { role: 'admin', email: 'a@test' });
      const marta = await seedPerson('marta@test', 'kid', ['bb:00:00:00:00:01']);
      await app.inject({
        method: 'PUT',
        url: `/api/people/${marta.id}/bedtime`,
        headers: authHeader(signAccess(app, admin)),
        payload: { days: [1], startMinute: 1320, endMinute: 420 },
      });

      await app.prisma.user.delete({ where: { id: marta.id } });
      const rows = await app.prisma.accessSchedule.findMany();
      expect(rows).toHaveLength(0);
    });
  });
});
