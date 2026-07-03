import type { AccessSchedule } from '@krakenos/types';
import { describe, expect, it } from 'vitest';
import { activeBlockedMacs, isActiveAt } from '../../src/modules/access/schedule-eval.js';

function sched(partial: Partial<AccessSchedule>): AccessSchedule {
  return {
    id: 's1',
    name: 'Test',
    mac: 'aa:bb:cc:dd:ee:ff',
    enabled: true,
    days: [1],
    startMinute: 8 * 60,
    endMinute: 17 * 60,
    createdAt: '2026-07-03T00:00:00.000Z',
    ...partial,
  };
}

/** Un `Date` con día de la semana y hora local concretos (2026-07 empieza en miércoles). */
function at(dow: number, hour: number, min = 0): Date {
  // 2026-07-05 es domingo → dow 0. Sumamos `dow` días.
  return new Date(2026, 6, 5 + dow, hour, min, 0);
}

describe('schedule-eval (US-108)', () => {
  it('ventana normal dentro del mismo día', () => {
    const s = sched({ days: [1], startMinute: 480, endMinute: 1020 }); // lun 08:00–17:00
    expect(isActiveAt(s, 1, 540)).toBe(true); // lun 09:00
    expect(isActiveAt(s, 1, 479)).toBe(false); // lun 07:59
    expect(isActiveAt(s, 1, 1020)).toBe(false); // fin exclusivo
    expect(isActiveAt(s, 2, 540)).toBe(false); // martes, no en days
  });

  it('ventana que cruza la medianoche (bedtime 21:00–07:00 los domingos)', () => {
    const s = sched({ days: [0], startMinute: 21 * 60, endMinute: 7 * 60 });
    expect(isActiveAt(s, 0, 22 * 60)).toBe(true); // dom 22:00 (empieza hoy)
    expect(isActiveAt(s, 1, 6 * 60)).toBe(true); // lun 06:00 (arrastre desde el domingo)
    expect(isActiveAt(s, 1, 7 * 60)).toBe(false); // lun 07:00 (fin exclusivo)
    expect(isActiveAt(s, 0, 20 * 60)).toBe(false); // dom 20:00 (antes)
    expect(isActiveAt(s, 1, 8 * 60)).toBe(false); // lun 08:00 (ya fuera)
  });

  it('deshabilitado o sin días → nunca activo', () => {
    expect(isActiveAt(sched({ enabled: false }), 1, 540)).toBe(false);
    expect(isActiveAt(sched({ days: [] }), 1, 540)).toBe(false);
  });

  it('activeBlockedMacs une los MAC de los horarios activos', () => {
    const a = sched({ mac: 'aa', days: [0], startMinute: 480, endMinute: 1020 });
    const b = sched({ mac: 'bb', days: [0], startMinute: 0, endMinute: 60 });
    const active = activeBlockedMacs([a, b], at(0, 9)); // domingo 09:00
    expect([...active]).toEqual(['aa']);
  });
});
