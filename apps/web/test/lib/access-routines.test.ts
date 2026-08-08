import type { AccessSchedule } from '@krakenos/types';
import { describe, expect, it } from 'vitest';
import { agruparHorariosDeAcceso } from '@/lib/access-routines';

/**
 * Los horarios de acceso vistos como rutinas (US-256). Lo que se prueba: que la
 * hora de dormir de una persona con varios aparatos sale **una vez** con su
 * número real, y que la MAC no se publica.
 */

const NOMBRES = {
  personas: new Map([['u1', 'Marta']]),
  aparatos: new Map([['aa:bb:cc:dd:ee:01', 'Tablet del salón']]),
  personaSinNombre: 'Una persona del hogar',
};

function horario(over: Partial<AccessSchedule> = {}): AccessSchedule {
  return {
    id: 'h1',
    name: 'Hora de dormir',
    mac: 'aa:bb:cc:dd:ee:01',
    enabled: true,
    days: [1, 2, 3, 4, 5],
    startMinute: 22 * 60,
    endMinute: 7 * 60,
    personId: null,
    createdAt: '',
    ...over,
  };
}

describe('agruparHorariosDeAcceso', () => {
  it('agrupa la hora de dormir de una persona y declara a cuántos aparatos llega', () => {
    // US-240 replica el horario de persona en una fila por aparato: sin agrupar,
    // alguien con tres aparatos aparecería tres veces con la misma franja.
    const filas = agruparHorariosDeAcceso(
      [
        horario({ id: 'a', personId: 'u1', mac: 'm1' }),
        horario({ id: 'b', personId: 'u1', mac: 'm2' }),
        horario({ id: 'c', personId: 'u1', mac: 'm3' }),
      ],
      NOMBRES,
    );
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      sujeto: 'Marta',
      franja: '22:00–07:00',
      dias: 'L M X J V',
      aparatos: 3,
      dePersona: true,
    });
  });

  it('dos franjas distintas de la misma persona son dos rutinas', () => {
    const filas = agruparHorariosDeAcceso(
      [
        horario({ id: 'a', personId: 'u1', mac: 'm1' }),
        horario({ id: 'b', personId: 'u1', mac: 'm1', startMinute: 15 * 60, endMinute: 16 * 60 }),
      ],
      NOMBRES,
    );
    expect(filas).toHaveLength(2);
  });

  it('un horario de dispositivo se nombra por su etiqueta, nunca por la MAC', () => {
    // Esta lista la ve cualquier rol autenticado y la MAC identifica al aparato
    // en la red: es justo lo que el resto del producto se cuida de no publicar.
    const filas = agruparHorariosDeAcceso([horario()], NOMBRES);
    expect(filas[0]!.sujeto).toBe('Tablet del salón');
    expect(JSON.stringify(filas)).not.toContain('aa:bb:cc:dd:ee:01');
  });

  it('sin etiqueta del aparato cae al nombre del horario, no a la MAC', () => {
    const filas = agruparHorariosDeAcceso([horario({ mac: 'desconocida' })], NOMBRES);
    expect(filas[0]!.sujeto).toBe('Hora de dormir');
  });

  it('sin poder nombrar a la persona no se enseña su id', () => {
    // Un rol que no puede listar usuarios no debe ver un cuid opaco en pantalla.
    const filas = agruparHorariosDeAcceso([horario({ personId: 'u9' })], NOMBRES);
    expect(filas[0]!.sujeto).toBe('Una persona del hogar');
    expect(filas[0]!.sujeto).not.toContain('u9');
  });

  it('basta una fila activa para que el grupo cuente como activo', () => {
    const filas = agruparHorariosDeAcceso(
      [
        horario({ id: 'a', personId: 'u1', mac: 'm1', enabled: false }),
        horario({ id: 'b', personId: 'u1', mac: 'm2', enabled: true }),
      ],
      NOMBRES,
    );
    expect(filas[0]!.habilitada).toBe(true);
    expect(filas[0]!.aparatos).toBe(2);
  });

  it('ordena los días aunque lleguen desordenados', () => {
    const filas = agruparHorariosDeAcceso([horario({ days: [5, 0, 3] })], NOMBRES);
    expect(filas[0]!.dias).toBe('D X V');
  });

  it('sin horarios no hay filas', () => {
    expect(agruparHorariosDeAcceso([], NOMBRES)).toEqual([]);
  });
});
