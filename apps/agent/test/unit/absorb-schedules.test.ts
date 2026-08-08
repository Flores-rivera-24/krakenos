import type { IotSchedule } from '@krakenos/types';
import { describe, expect, it } from 'vitest';
import { planDeAbsorcion } from '../../src/automations/absorb-schedules.js';

/**
 * Absorción de los horarios IoT por el motor de rutinas (US-256). Lo que se
 * prueba es que la traducción es **sin pérdida** —cada campo acaba donde
 * corresponde— y que lo que no se puede expresar **se omite en vez de
 * inventarse**: es una migración de datos del usuario y no hay segunda pasada.
 */

function horario(over: Partial<IotSchedule> = {}): IotSchedule {
  return {
    id: 's1',
    name: 'Luz del salón',
    enabled: true,
    days: [1, 2, 3, 4, 5],
    time: { kind: 'fixed', minute: 20 * 60 },
    target: { type: 'device', deviceId: 'hue:foco-1', on: true },
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

describe('planDeAbsorcion — hora fija', () => {
  it('un horario a hora fija es una regla con disparador `time`', () => {
    const { absorbidos, omitidos } = planDeAbsorcion([horario()]);
    expect(omitidos).toEqual([]);
    expect(absorbidos).toHaveLength(1);
    const { regla, origen } = absorbidos[0]!;
    expect(origen).toBe('s1');
    expect(regla.name).toBe('Luz del salón');
    expect(regla.enabled).toBe(true);
    expect(regla.trigger).toEqual({ type: 'time', days: [1, 2, 3, 4, 5], minute: 1200 });
    expect(regla.actions).toEqual([{ type: 'iot-set', deviceId: 'hue:foco-1', on: true }]);
  });

  it('conserva el brillo y NO inventa los campos ausentes', () => {
    // Un `on: undefined` explícito no es «no toques el interruptor»: el esquema
    // del borde no admite nulos y la acción tiene que salir sin la clave.
    const { absorbidos } = planDeAbsorcion([
      horario({ target: { type: 'device', deviceId: 'x', brightness: 40 } }),
    ]);
    expect(absorbidos[0]!.regla.actions).toEqual([
      { type: 'iot-set', deviceId: 'x', brightness: 40 },
    ]);
    expect(Object.keys(absorbidos[0]!.regla.actions[0]!)).not.toContain('on');
  });

  it('un horario apagado sigue apagado al mudarse de sitio', () => {
    const { absorbidos } = planDeAbsorcion([horario({ enabled: false })]);
    expect(absorbidos[0]!.regla.enabled).toBe(false);
  });

  it('una escena programada es una acción `scene-run`', () => {
    const { absorbidos } = planDeAbsorcion([
      horario({ target: { type: 'scene', sceneId: 'esc-1' } }),
    ]);
    expect(absorbidos[0]!.regla.actions).toEqual([{ type: 'scene-run', sceneId: 'esc-1' }]);
  });

  it('normaliza los días: sin repetidos y ordenados', () => {
    const { absorbidos } = planDeAbsorcion([horario({ days: [5, 1, 1, 3] })]);
    expect(absorbidos[0]!.regla.trigger).toMatchObject({ days: [1, 3, 5] });
  });
});

describe('planDeAbsorcion — solar', () => {
  it('amanecer y atardecer se traducen al disparador `sun` con su desfase', () => {
    const { absorbidos } = planDeAbsorcion([
      horario({ id: 'a', time: { kind: 'sunrise', offsetMin: 30 } }),
      horario({ id: 'b', time: { kind: 'sunset', offsetMin: -15 } }),
    ]);
    expect(absorbidos[0]!.regla.trigger).toEqual({
      type: 'sun',
      event: 'sunrise',
      offsetMin: 30,
      days: [1, 2, 3, 4, 5],
    });
    expect(absorbidos[1]!.regla.trigger).toEqual({
      type: 'sun',
      event: 'sunset',
      offsetMin: -15,
      days: [1, 2, 3, 4, 5],
    });
  });
});

describe('planDeAbsorcion — lo que no se puede expresar', () => {
  it('un horario sin días se omite en vez de darle todos', () => {
    // Es una fila que nunca disparó. Regalarle siete días la convierte en una
    // rutina que el usuario no escribió, y que empieza a actuar si la enciende.
    const { absorbidos, omitidos } = planDeAbsorcion([horario({ days: [] })]);
    expect(absorbidos).toEqual([]);
    expect(omitidos).toHaveLength(1);
    expect(omitidos[0]).toMatchObject({ origen: 's1', nombre: 'Luz del salón' });
    expect(omitidos[0]!.motivo).toContain('días');
  });

  it('un objetivo vacío (fila corrupta degradada) se omite', () => {
    const { absorbidos, omitidos } = planDeAbsorcion([
      horario({ target: { type: 'device', deviceId: '' } }),
    ]);
    expect(absorbidos).toEqual([]);
    expect(omitidos).toHaveLength(1);
  });

  it('una escena sin id se omite', () => {
    const { omitidos } = planDeAbsorcion([horario({ target: { type: 'scene', sceneId: '' } })]);
    expect(omitidos).toHaveLength(1);
  });

  it('lo omitido no arrastra a lo bueno', () => {
    const { absorbidos, omitidos } = planDeAbsorcion([
      horario({ id: 'roto', days: [] }),
      horario({ id: 'bueno' }),
    ]);
    expect(absorbidos.map((a) => a.origen)).toEqual(['bueno']);
    expect(omitidos.map((o) => o.origen)).toEqual(['roto']);
  });

  it('sin horarios no hay nada que absorber', () => {
    expect(planDeAbsorcion([])).toEqual({ absorbidos: [], omitidos: [] });
  });
});
