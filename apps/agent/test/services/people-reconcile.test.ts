import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AccessScheduleService } from '../../src/modules/access/access.service.js';
import { PeopleService } from '../../src/modules/people/people.service.js';
import { createDriver } from '../../src/drivers/index.js';
import { buildTestApp, resetDb, seedUser } from '../helpers/app.js';

/**
 * Reconciliación de los horarios de persona contra el inventario (US-240),
 * **sobre la DB real** y disparada por el barrido de acceso, que es como corre en
 * producción. La lógica pura ya está probada en `bedtime-plan.test.ts`; lo que se
 * ata aquí es el cableado: que el barrido la llame y que el efecto se persista.
 *
 * El fallo que evita es concreto: un aparato que cambia de dueño se quedaría
 * cortado por el horario de su dueño anterior, sin nadie a quien atribuirlo en la
 * UI y sin error en ningún log.
 */
describe('PeopleService.reconcile (US-240)', () => {
  let app: FastifyInstance;
  let access: AccessScheduleService;
  let people: PeopleService;

  beforeAll(async () => {
    app = await buildTestApp();
    access = new AccessScheduleService(app, createDriver({ kind: 'mock' }));
    people = new PeopleService(app, access);
    access.setPersonReconciler(() => people.reconcile());
  });

  afterAll(async () => {
    access.stop();
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(app);
  });

  async function seedMarta(macs: string[]) {
    const marta = await seedUser(app, { role: 'kid', email: 'marta@test' });
    for (const [i, mac] of macs.entries()) {
      await app.prisma.device.create({
        data: { mac, ip: `10.0.0.${i + 10}`, ownerId: marta.id },
      });
    }
    await people.setBedtime(marta.id, { days: [1, 2, 3, 4, 5], startMinute: 1320, endMinute: 420 });
    return marta;
  }

  it('el barrido quita el horario del aparato que cambió de dueño', async () => {
    const marta = await seedMarta(['bb:00:00:00:00:01', 'bb:00:00:00:00:02']);
    const luis = await seedUser(app, { role: 'member', email: 'luis@test' });
    expect(await app.prisma.accessSchedule.count()).toBe(2);

    // El portátil pasa a ser de Luis.
    await app.prisma.device.update({
      where: { mac: 'bb:00:00:00:00:02' },
      data: { ownerId: luis.id },
    });

    await access.tick();

    const rows = await app.prisma.accessSchedule.findMany();
    expect(rows).toHaveLength(1);
    // Sobrevive el de Marta, y NO se le regala a Luis, que no tiene hora de dormir.
    expect(rows[0]?.mac).toBe('bb:00:00:00:00:01');
    expect(rows[0]?.personId).toBe(marta.id);
  });

  it('el barrido extiende la hora de dormir al aparato nuevo de la persona', async () => {
    const marta = await seedMarta(['bb:00:00:00:00:01']);
    await app.prisma.device.create({
      data: { mac: 'bb:00:00:00:00:09', ip: '10.0.0.99', ownerId: marta.id },
    });

    await access.tick();

    const rows = await app.prisma.accessSchedule.findMany({ orderBy: { mac: 'asc' } });
    expect(rows.map((r) => r.mac)).toEqual(['bb:00:00:00:00:01', 'bb:00:00:00:00:09']);
    // Con la MISMA ventana: la nueva se clona, no se inventa.
    expect(rows[1]?.startMinute).toBe(1320);
    expect(rows[1]?.endMinute).toBe(420);
  });

  it('deja en paz los horarios sueltos por dispositivo', async () => {
    await seedMarta(['bb:00:00:00:00:01']);
    await app.prisma.accessSchedule.create({
      data: {
        name: 'Deberes',
        mac: 'ff:00:00:00:00:01', // ni siquiera es un dispositivo del inventario
        days: '[1]',
        startMinute: 900,
        endMinute: 1000,
      },
    });

    await access.tick();

    const sueltos = await app.prisma.accessSchedule.findMany({ where: { personId: null } });
    expect(sueltos).toHaveLength(1);
  });

  it('un fallo de la reconciliación no impide aplicar el bloqueo del barrido', async () => {
    await seedMarta(['bb:00:00:00:00:01']);
    access.setPersonReconciler(() => Promise.reject(new Error('boom')));

    // El barrido no propaga el fallo: el enforcement es lo importante.
    await expect(access.tick()).resolves.toBeUndefined();

    access.setPersonReconciler(() => people.reconcile());
  });
});
