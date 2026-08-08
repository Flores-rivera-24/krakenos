import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ScheduleAbsorptionService } from '../../src/modules/automations/absorb.service.js';
import { buildTestApp, resetDb } from '../helpers/app.js';

/**
 * Absorción de los horarios IoT por las rutinas (US-256), contra base real.
 *
 * Lo que se prueba aquí y no se puede probar en la unitaria: que **no duplica**
 * —es la única propiedad cuyo fallo el usuario paga con cada rutina repetida— y
 * que las filas de origen **se conservan**, porque la traducción no tiene
 * segunda oportunidad si algo salió mal.
 */
describe('absorción de horarios IoT (US-256)', () => {
  let app: FastifyInstance;

  const DONE_KEY = 'automations.absorbedIotSchedules.v1';

  beforeAll(async () => {
    app = await buildTestApp({ routes: true });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(app);
  });

  async function sembrarHorario(over: Record<string, unknown> = {}) {
    return app.prisma.iotSchedule.create({
      data: {
        name: 'Luz al atardecer',
        enabled: true,
        days: JSON.stringify([1, 2, 3]),
        time: JSON.stringify({ kind: 'sunset', offsetMin: -15 }),
        target: JSON.stringify({ type: 'device', deviceId: 'hue:foco-1', on: true }),
        ...over,
      },
    });
  }

  it('convierte cada horario en una rutina equivalente y marca el trabajo hecho', async () => {
    await sembrarHorario();
    const creadas = await new ScheduleAbsorptionService(app).run();
    expect(creadas).toBe(1);

    const reglas = await app.prisma.automationRule.findMany();
    expect(reglas).toHaveLength(1);
    expect(reglas[0]!.name).toBe('Luz al atardecer');
    expect(JSON.parse(reglas[0]!.trigger)).toEqual({
      type: 'sun',
      event: 'sunset',
      offsetMin: -15,
      days: [1, 2, 3],
    });
    expect(JSON.parse(reglas[0]!.actions)).toEqual([
      { type: 'iot-set', deviceId: 'hue:foco-1', on: true },
    ]);

    const marca = await app.prisma.setting.findUnique({ where: { key: DONE_KEY } });
    expect(marca?.value).toBe('true');
  });

  it('no duplica al arrancar dos veces', async () => {
    await sembrarHorario();
    await new ScheduleAbsorptionService(app).run();
    const segunda = await new ScheduleAbsorptionService(app).run();
    expect(segunda).toBeNull(); // ya estaba hecha: ni mira la tabla
    expect(await app.prisma.automationRule.count()).toBe(1);
  });

  it('conserva la fila de origen: no borra lo que acaba de traducir', async () => {
    const fila = await sembrarHorario();
    await new ScheduleAbsorptionService(app).run();
    // La tabla queda como archivo de solo lectura (sin rutas, sin UI, sin
    // barrido), así que no puede disparar dos veces y sigue siendo la única
    // copia de lo que el usuario escribió si la traducción falló.
    expect(await app.prisma.iotSchedule.findUnique({ where: { id: fila.id } })).not.toBeNull();
  });

  it('conserva la fecha de creación para no reordenar la lista del usuario', async () => {
    const antigua = new Date('2026-01-15T10:00:00.000Z');
    await sembrarHorario({ name: 'Vieja', createdAt: antigua });
    await new ScheduleAbsorptionService(app).run();
    const regla = await app.prisma.automationRule.findFirst({ where: { name: 'Vieja' } });
    expect(regla?.createdAt.toISOString()).toBe(antigua.toISOString());
  });

  it('una instalación nueva se marca hecha sin crear nada', async () => {
    const creadas = await new ScheduleAbsorptionService(app).run();
    expect(creadas).toBe(0);
    expect(await app.prisma.automationRule.count()).toBe(0);
    const marca = await app.prisma.setting.findUnique({ where: { key: DONE_KEY } });
    expect(marca?.value).toBe('true');
  });

  it('una fila corrupta se omite y NO impide absorber las buenas', async () => {
    await sembrarHorario({ name: 'Rota', time: 'esto no es json' });
    await sembrarHorario({ name: 'Buena' });
    const creadas = await new ScheduleAbsorptionService(app).run();
    expect(creadas).toBe(1);
    const reglas = await app.prisma.automationRule.findMany();
    expect(reglas.map((r) => r.name)).toEqual(['Buena']);
    // Y la rota sigue en su tabla: omitir no es borrar.
    expect(await app.prisma.iotSchedule.count()).toBe(2);
  });

  it('un horario apagado llega apagado', async () => {
    await sembrarHorario({ enabled: false });
    await new ScheduleAbsorptionService(app).run();
    const regla = await app.prisma.automationRule.findFirst();
    expect(regla?.enabled).toBe(false);
  });
});
