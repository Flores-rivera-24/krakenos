import type { AccessSchedule } from '@krakenos/types';
import { describe, expect, it } from 'vitest';
import {
  deviceDisplayName,
  groupByPerson,
  summarizeBedtime,
  type DeviceRow,
} from '../../src/modules/people/people-group.js';

/**
 * Agrupación por persona (US-240). Lo que estos tests protegen no es el `groupBy`
 * —eso no se rompe solo— sino las tres decisiones que sí: que el bloqueo se
 * **derive** y no se lea de la columna, que la MAC **no salga**, y que la hora de
 * dormir no se declare más completa de lo que está.
 */

// Hora **local**, no UTC: `dowAndMinute` lee `getDay()`/`getHours()` del servidor,
// así que un instante en Z haría que estos tests pasaran o fallaran según la zona
// horaria de quien los corra.
const NOW = new Date(2026, 6, 30, 22, 30); // jueves 30/07/2026, 22:30 local

function device(over: Partial<DeviceRow> = {}): DeviceRow {
  return {
    id: 'dev-000001',
    mac: 'aa:bb:cc:dd:ee:01',
    label: 'Tablet',
    hostname: null,
    online: true,
    isBlocked: false,
    pausedUntil: null,
    ownerId: 'user-marta',
    ...over,
  };
}

function schedule(over: Partial<AccessSchedule> = {}): AccessSchedule {
  return {
    id: 'sch-1',
    name: 'Hora de dormir',
    mac: 'aa:bb:cc:dd:ee:01',
    enabled: true,
    days: [0, 1, 2, 3, 4, 5, 6],
    startMinute: 22 * 60, // 22:00
    endMinute: 7 * 60, // 07:00 (cruza medianoche)
    personId: 'user-marta',
    createdAt: NOW.toISOString(),
    ...over,
  };
}

const MARTA = { id: 'user-marta', displayName: 'Marta', role: 'kid' };

describe('groupByPerson (US-240)', () => {
  it('agrupa los dispositivos bajo su dueño con el conteo en línea', () => {
    const people = groupByPerson({
      devices: [
        device({ id: 'd1', mac: 'aa:00:00:00:00:01', label: 'Tablet', online: true }),
        device({ id: 'd2', mac: 'aa:00:00:00:00:02', label: 'Móvil', online: false }),
        device({ id: 'd3', mac: 'aa:00:00:00:00:03', label: 'Portátil', online: true }),
      ],
      people: [MARTA],
      schedules: [],
      now: NOW,
      unassignedLabel: 'Sin asignar',
    });

    expect(people).toHaveLength(1);
    // Conteos asimétricos a propósito: con 2 y 2, invertir la condición daría lo mismo.
    expect(people[0]?.devices).toHaveLength(3);
    expect(people[0]?.onlineCount).toBe(2);
    expect(people[0]?.blockedCount).toBe(0);
    // Orden estable por nombre.
    expect(people[0]?.devices.map((d) => d.name)).toEqual(['Móvil', 'Portátil', 'Tablet']);
  });

  it('deriva el bloqueo de las TRES fuentes y nunca de `isBlocked`', () => {
    const people = groupByPerson({
      devices: [
        // Manual.
        device({ id: 'd1', mac: 'aa:00:00:00:00:01', label: 'A', isBlocked: true }),
        // Horario activo con la columna en `false`: la trampa que US-236 documentó.
        device({ id: 'd2', mac: 'aa:00:00:00:00:02', label: 'B', isBlocked: false }),
        // Pausa viva.
        device({
          id: 'd3',
          mac: 'aa:00:00:00:00:03',
          label: 'C',
          pausedUntil: new Date(NOW.getTime() + 60_000),
        }),
        // Pausa YA EXPIRADA: `pausedUntil` no se limpia, así que leerlo como
        // `!= null` daría un bloqueo permanente falso.
        device({
          id: 'd4',
          mac: 'aa:00:00:00:00:04',
          label: 'D',
          pausedUntil: new Date(NOW.getTime() - 60_000),
        }),
      ],
      people: [MARTA],
      schedules: [schedule({ mac: 'aa:00:00:00:00:02' })],
      now: NOW,
      unassignedLabel: 'Sin asignar',
    });

    const byName = new Map(people[0]?.devices.map((d) => [d.name, d]));
    expect(byName.get('A')?.reasons).toEqual(['manual']);
    expect(byName.get('B')?.blocked).toBe(true);
    expect(byName.get('B')?.reasons).toEqual(['schedule']);
    expect(byName.get('C')?.reasons).toEqual(['paused']);
    expect(byName.get('D')?.blocked).toBe(false);
    expect(byName.get('D')?.pausedUntil).toBeNull();
    expect(people[0]?.blockedCount).toBe(3);
  });

  it('no publica MAC ni IP de los dispositivos', () => {
    const people = groupByPerson({
      devices: [device({ mac: 'aa:bb:cc:dd:ee:ff' })],
      people: [MARTA],
      schedules: [],
      now: NOW,
      unassignedLabel: 'Sin asignar',
    });
    const serialized = JSON.stringify(people);
    expect(serialized).not.toContain('aa:bb:cc:dd:ee:ff');
    expect(serialized).not.toMatch(/([0-9a-f]{2}:){5}[0-9a-f]{2}/i);
  });

  it('nombra un dispositivo sin etiqueta con su id, nunca con su MAC', () => {
    expect(deviceDisplayName({ id: 'clx0000abcdef', label: null, hostname: null })).toBe(
      'Dispositivo abcdef',
    );
    expect(deviceDisplayName({ id: 'x', label: null, hostname: 'pc-salon' })).toBe('pc-salon');
  });

  it('enseña la pausa que más tarda en levantarse', () => {
    const pronto = new Date(NOW.getTime() + 60_000);
    const tarde = new Date(NOW.getTime() + 3_600_000);
    const people = groupByPerson({
      devices: [
        device({ id: 'd1', mac: 'aa:00:00:00:00:01', pausedUntil: pronto }),
        device({ id: 'd2', mac: 'aa:00:00:00:00:02', pausedUntil: tarde }),
      ],
      people: [MARTA],
      schedules: [],
      now: NOW,
      unassignedLabel: 'Sin asignar',
    });
    expect(people[0]?.pausedUntil).toBe(tarde.toISOString());
  });

  it('incluye a una persona sin dispositivos, en vez de esconderla', () => {
    const people = groupByPerson({
      devices: [],
      people: [MARTA],
      schedules: [],
      now: NOW,
      unassignedLabel: 'Sin asignar',
    });
    expect(people).toHaveLength(1);
    expect(people[0]?.devices).toEqual([]);
  });

  it('agrupa los aparatos huérfanos al final, y solo si los hay', () => {
    const sinHuerfanos = groupByPerson({
      devices: [device()],
      people: [MARTA],
      schedules: [],
      now: NOW,
      unassignedLabel: 'Sin asignar',
    });
    expect(sinHuerfanos.map((p) => p.userId)).toEqual(['user-marta']);

    const conHuerfanos = groupByPerson({
      devices: [device(), device({ id: 'd9', mac: 'ff:00:00:00:00:09', ownerId: null })],
      people: [MARTA],
      schedules: [],
      now: NOW,
      unassignedLabel: 'Sin asignar',
    });
    expect(conHuerfanos.map((p) => p.userId)).toEqual(['user-marta', null]);
    expect(conHuerfanos[1]?.name).toBe('Sin asignar');
    // El grupo sin dueño no tiene hora de dormir: no hay persona a quien atarla.
    expect(conHuerfanos[1]?.bedtime).toBeNull();
  });

  it('solo cuenta como hora de dormir los horarios CON persona', () => {
    const people = groupByPerson({
      devices: [device({ mac: 'aa:00:00:00:00:01' })],
      people: [MARTA],
      schedules: [schedule({ mac: 'aa:00:00:00:00:01', personId: null })],
      now: NOW,
      unassignedLabel: 'Sin asignar',
    });
    // El horario suelto sigue cortando internet…
    expect(people[0]?.devices[0]?.blocked).toBe(true);
    // …pero no es la hora de dormir de la persona: editarla no debe tocarlo.
    expect(people[0]?.bedtime).toBeNull();
  });
});

describe('summarizeBedtime (US-240)', () => {
  it('devuelve null sin horarios de persona', () => {
    expect(summarizeBedtime([])).toBeNull();
  });

  it('cuenta a cuántos aparatos está aplicada de verdad', () => {
    const bedtime = summarizeBedtime([
      schedule({ id: 's1', mac: 'aa:00:00:00:00:01' }),
      schedule({ id: 's2', mac: 'aa:00:00:00:00:02' }),
    ]);
    expect(bedtime?.appliedTo).toBe(2);
    expect(bedtime?.startMinute).toBe(1320);
    expect(bedtime?.endMinute).toBe(420);
  });

  it('no promedia una ventana editada a mano: la declara incompleta', () => {
    const bedtime = summarizeBedtime([
      schedule({ id: 's1', mac: 'aa:00:00:00:00:01' }),
      schedule({ id: 's2', mac: 'aa:00:00:00:00:02' }),
      // Alguien movió este a las 23:30 desde el detalle del dispositivo.
      schedule({ id: 's3', mac: 'aa:00:00:00:00:03', startMinute: 23 * 60 + 30 }),
    ]);
    expect(bedtime?.appliedTo).toBe(2);
    // La ventana que se enseña es una que EXISTE, no un promedio inventado.
    expect(bedtime?.startMinute).toBe(1320);
  });

  it('considera igual una ventana con los mismos días en otro orden', () => {
    const bedtime = summarizeBedtime([
      schedule({ id: 's1', mac: 'aa:00:00:00:00:01', days: [1, 2, 3] }),
      schedule({ id: 's2', mac: 'aa:00:00:00:00:02', days: [3, 1, 2] }),
    ]);
    expect(bedtime?.appliedTo).toBe(2);
  });
});
