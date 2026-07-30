import { describe, expect, it } from 'vitest';
import {
  planPersonScheduleReconcile,
  type PersonScheduleRow,
} from '../../src/modules/people/bedtime-plan.js';

/**
 * Reconciliación de los horarios de persona (US-240). Las dos direcciones tienen
 * consecuencias distintas y **las dos** están cubiertas aquí: el corte que
 * sobrevive a su dueño (grave y visible) y el aparato nuevo que se queda fuera
 * (silencioso, se descubre cuando ya no sirve de nada).
 */

function row(over: Partial<PersonScheduleRow> = {}): PersonScheduleRow {
  return {
    id: 's1',
    mac: 'aa:00:00:00:00:01',
    personId: 'marta',
    name: 'Hora de dormir',
    enabled: true,
    days: '[0,1,2,3,4,5,6]',
    startMinute: 1320,
    endMinute: 420,
    ...over,
  };
}

describe('planPersonScheduleReconcile (US-240)', () => {
  it('no toca nada cuando el horario y el inventario ya cuadran', () => {
    const plan = planPersonScheduleReconcile({
      rows: [row()],
      ownerByMac: new Map([['aa:00:00:00:00:01', 'marta']]),
    });
    expect(plan).toEqual({ deleteIds: [], create: [] });
  });

  it('borra el horario de un aparato que cambió de dueño', () => {
    const plan = planPersonScheduleReconcile({
      rows: [row({ id: 'viejo' })],
      ownerByMac: new Map([['aa:00:00:00:00:01', 'luis']]),
    });
    expect(plan.deleteIds).toEqual(['viejo']);
    // Y no se lo pasa a Luis: Luis no tiene hora de dormir propia.
    expect(plan.create).toEqual([]);
  });

  it('borra el horario de un aparato que se quedó sin dueño', () => {
    const plan = planPersonScheduleReconcile({
      rows: [row({ id: 'huerfano' })],
      ownerByMac: new Map([['aa:00:00:00:00:01', null]]),
    });
    expect(plan.deleteIds).toEqual(['huerfano']);
  });

  it('borra el horario de un aparato que ya no está en el inventario', () => {
    const plan = planPersonScheduleReconcile({
      rows: [row({ id: 'fantasma' })],
      ownerByMac: new Map(),
    });
    expect(plan.deleteIds).toEqual(['fantasma']);
  });

  it('extiende la hora de dormir al aparato nuevo de la persona', () => {
    const plan = planPersonScheduleReconcile({
      rows: [row({ id: 's1', mac: 'aa:00:00:00:00:01' })],
      ownerByMac: new Map([
        ['aa:00:00:00:00:01', 'marta'],
        ['aa:00:00:00:00:02', 'marta'], // tablet nueva
      ]),
    });
    expect(plan.deleteIds).toEqual([]);
    expect(plan.create).toEqual([
      {
        mac: 'aa:00:00:00:00:02',
        personId: 'marta',
        name: 'Hora de dormir',
        enabled: true,
        days: '[0,1,2,3,4,5,6]',
        startMinute: 1320,
        endMinute: 420,
      },
    ]);
  });

  it('clona el estado desactivado, no lo reactiva por la puerta de atrás', () => {
    const plan = planPersonScheduleReconcile({
      rows: [row({ enabled: false })],
      ownerByMac: new Map([
        ['aa:00:00:00:00:01', 'marta'],
        ['aa:00:00:00:00:02', 'marta'],
      ]),
    });
    expect(plan.create[0]?.enabled).toBe(false);
  });

  it('no inventa hora de dormir para quien no la tiene', () => {
    const plan = planPersonScheduleReconcile({
      rows: [],
      ownerByMac: new Map([['aa:00:00:00:00:01', 'luis']]),
    });
    expect(plan).toEqual({ deleteIds: [], create: [] });
  });

  it('mantiene separadas a dos personas con horarios distintos', () => {
    const plan = planPersonScheduleReconcile({
      rows: [
        row({ id: 's1', mac: 'aa:00:00:00:00:01', personId: 'marta', startMinute: 1320 }),
        row({ id: 's2', mac: 'bb:00:00:00:00:01', personId: 'luis', startMinute: 1380 }),
      ],
      ownerByMac: new Map([
        ['aa:00:00:00:00:01', 'marta'],
        ['aa:00:00:00:00:02', 'marta'],
        ['bb:00:00:00:00:01', 'luis'],
        ['bb:00:00:00:00:02', 'luis'],
      ]),
    });
    const byMac = new Map(plan.create.map((c) => [c.mac, c]));
    expect(byMac.get('aa:00:00:00:00:02')?.startMinute).toBe(1320);
    expect(byMac.get('bb:00:00:00:00:02')?.startMinute).toBe(1380);
  });
});
