import type { AccessSchedule } from '@krakenos/types';
import { describe, expect, it } from 'vitest';
import {
  evaluateBlocked,
  groupSchedulesByMac,
  primaryReason,
} from '../../src/modules/access/blocked-eval.js';

const MAC = 'aa:bb:cc:dd:ee:ff';

/** Horario activo de lunes a domingo entre las 21:00 y las 07:00 (cruza medianoche). */
function horarioNocturno(mac = MAC): AccessSchedule {
  return {
    id: 's1',
    name: 'Noche',
    mac,
    enabled: true,
    days: [0, 1, 2, 3, 4, 5, 6],
    startMinute: 21 * 60,
    endMinute: 7 * 60,
    createdAt: new Date().toISOString(),
  };
}

/** 2026-07-29 a las 22:30 (dentro de la ventana nocturna). */
const DENTRO = new Date(2026, 6, 29, 22, 30);
/** 2026-07-29 a las 12:00 (fuera de la ventana). */
const FUERA = new Date(2026, 6, 29, 12, 0);

describe('evaluateBlocked (US-236)', () => {
  it('sin ninguna fuente activa, no está bloqueado', () => {
    const r = evaluateBlocked({ isBlocked: false, pausedUntil: null, schedules: [], mac: MAC, now: FUERA });
    expect(r).toEqual({ blocked: false, reasons: [], pausedUntil: null });
    expect(primaryReason(r)).toBeNull();
  });

  it('cada fuente por separado bloquea', () => {
    const manual = evaluateBlocked({ isBlocked: true, pausedUntil: null, schedules: [], mac: MAC, now: FUERA });
    expect(manual).toMatchObject({ blocked: true, reasons: ['manual'] });

    const horario = evaluateBlocked({ isBlocked: false, pausedUntil: null, schedules: [horarioNocturno()], mac: MAC, now: DENTRO });
    expect(horario).toMatchObject({ blocked: true, reasons: ['schedule'] });

    const futuro = new Date(FUERA.getTime() + 30 * 60_000);
    const pausa = evaluateBlocked({ isBlocked: false, pausedUntil: futuro, schedules: [], mac: MAC, now: FUERA });
    expect(pausa).toMatchObject({ blocked: true, reasons: ['paused'], pausedUntil: futuro });
  });

  /**
   * LA TRAMPA 1. Con un horario activo, `Device.isBlocked` vale `false` mientras el
   * driver sigue bloqueando: publicar la columna sería mentir. El derivado debe
   * decir que SÍ está bloqueado, y por qué.
   */
  it('con horario activo y la columna en false, sigue bloqueado (y dice que es por horario)', () => {
    const r = evaluateBlocked({
      isBlocked: false, // ← lo que dice la columna tras un `setBlocked(id,false)`
      pausedUntil: null,
      schedules: [horarioNocturno()],
      mac: MAC,
      now: DENTRO,
    });
    expect(r.blocked).toBe(true);
    expect(r.reasons).toEqual(['schedule']);
  });

  /**
   * LA TRAMPA 2. `pausedUntil` no se limpia al expirar (solo `resume()` lo pone a
   * `null`), así que leerlo como `!= null` da un positivo permanente.
   */
  it('una pausa EXPIRADA no bloquea, aunque la columna siga rellena', () => {
    const pasado = new Date(FUERA.getTime() - 60 * 60_000);
    const r = evaluateBlocked({ isBlocked: false, pausedUntil: pasado, schedules: [], mac: MAC, now: FUERA });
    expect(r.blocked).toBe(false);
    expect(r.reasons).toEqual([]);
    expect(r.pausedUntil).toBeNull();
  });

  it('acumula todas las razones en orden estable', () => {
    const futuro = new Date(DENTRO.getTime() + 30 * 60_000);
    const r = evaluateBlocked({
      isBlocked: true,
      pausedUntil: futuro,
      schedules: [horarioNocturno()],
      mac: MAC,
      now: DENTRO,
    });
    expect(r.reasons).toEqual(['manual', 'schedule', 'paused']);
    expect(primaryReason(r)).toBe('manual');
  });

  it('el horario de OTRO dispositivo no bloquea a este', () => {
    const r = evaluateBlocked({
      isBlocked: false,
      pausedUntil: null,
      schedules: [horarioNocturno('11:22:33:44:55:66')],
      mac: MAC,
      now: DENTRO,
    });
    expect(r.blocked).toBe(false);
  });

  it('un horario deshabilitado no cuenta', () => {
    const r = evaluateBlocked({
      isBlocked: false,
      pausedUntil: null,
      schedules: [{ ...horarioNocturno(), enabled: false }],
      mac: MAC,
      now: DENTRO,
    });
    expect(r.blocked).toBe(false);
  });
});

describe('groupSchedulesByMac', () => {
  it('agrupa por MAC para resolver N dispositivos sin una consulta por dispositivo', () => {
    const a = horarioNocturno('aa:aa:aa:aa:aa:aa');
    const b = { ...horarioNocturno('bb:bb:bb:bb:bb:bb'), id: 's2' };
    const c = { ...horarioNocturno('aa:aa:aa:aa:aa:aa'), id: 's3' };
    const byMac = groupSchedulesByMac([a, b, c]);
    expect(byMac.get('aa:aa:aa:aa:aa:aa')).toHaveLength(2);
    expect(byMac.get('bb:bb:bb:bb:bb:bb')).toHaveLength(1);
    expect(byMac.get('cc:cc:cc:cc:cc:cc')).toBeUndefined();
  });
});
