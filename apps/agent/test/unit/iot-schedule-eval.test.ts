import type { IotSchedule } from '@krakenos/types';
import { describe, expect, it } from 'vitest';
import { sunEventUtc } from '../../src/iot/solar.js';
import { isDueAt, triggerMinuteFor } from '../../src/modules/iot-schedule/schedule-eval.js';

const MADRID = { lat: 40.4168, lon: -3.7038 };

function schedule(over: Partial<IotSchedule> = {}): IotSchedule {
  return {
    id: 's1',
    name: 'x',
    enabled: true,
    days: [0, 1, 2, 3, 4, 5, 6],
    time: { kind: 'fixed', minute: 7 * 60 },
    target: { type: 'device', deviceId: 'plug', on: true },
    createdAt: '',
    ...over,
  };
}

describe('cálculo solar (US-168)', () => {
  it('amanecer/atardecer de Madrid en el solsticio de verano (±3 min de la efeméride)', () => {
    const sr = sunEventUtc(2026, 6, 21, MADRID.lat, MADRID.lon, 'sunrise')!;
    const ss = sunEventUtc(2026, 6, 21, MADRID.lat, MADRID.lon, 'sunset')!;
    // Efeméride: amanecer ~04:44Z, atardecer ~19:48Z.
    const srMin = sr.getUTCHours() * 60 + sr.getUTCMinutes();
    const ssMin = ss.getUTCHours() * 60 + ss.getUTCMinutes();
    expect(Math.abs(srMin - (4 * 60 + 44))).toBeLessThanOrEqual(3);
    expect(Math.abs(ssMin - (19 * 60 + 48))).toBeLessThanOrEqual(3);
  });

  it('devuelve null en noche polar (norte extremo en pleno invierno)', () => {
    // 78°N el 21 de diciembre: el sol no sale.
    expect(sunEventUtc(2026, 12, 21, 78, 15, 'sunrise')).toBeNull();
  });
});

describe('evaluador de horarios IoT (US-168)', () => {
  it('hora fija: el minuto de disparo es el configurado', () => {
    const t = triggerMinuteFor({ kind: 'fixed', minute: 420 }, new Date(2026, 5, 21, 12, 0), MADRID);
    expect(t).toBe(420);
  });

  it('evento solar sin ubicación configurada no dispara', () => {
    const t = triggerMinuteFor({ kind: 'sunset', offsetMin: -15 }, new Date(2026, 5, 21), null);
    expect(t).toBeNull();
  });

  it('dispara SOLO al cruzar el minuto programado, una vez', () => {
    const s = schedule({ time: { kind: 'fixed', minute: 7 * 60 } }); // 07:00
    const day = new Date(2026, 5, 21); // domingo, incluido en days
    const before = new Date(2026, 5, 21, 6, 59);
    const at = new Date(2026, 5, 21, 7, 0);
    const after = new Date(2026, 5, 21, 7, 1);

    expect(isDueAt(s, before, at, MADRID)).toBe(true); // cruza 07:00
    expect(isDueAt(s, at, after, MADRID)).toBe(false); // ya pasó, no re-dispara
    expect(isDueAt(s, before, before, MADRID)).toBe(false); // mismo minuto
    void day;
  });

  it('no dispara en un día no seleccionado ni si está deshabilitado', () => {
    const before = new Date(2026, 5, 21, 6, 59); // domingo (getDay 0)
    const at = new Date(2026, 5, 21, 7, 0);
    expect(isDueAt(schedule({ days: [1] }), before, at, MADRID)).toBe(false); // solo lunes
    expect(isDueAt(schedule({ enabled: false }), before, at, MADRID)).toBe(false);
  });

  it('maneja el cruce de medianoche', () => {
    const s = schedule({ time: { kind: 'fixed', minute: 0 } }); // 00:00
    const before = new Date(2026, 5, 21, 23, 59);
    const at = new Date(2026, 5, 22, 0, 0);
    expect(isDueAt(s, before, at, MADRID)).toBe(true);
  });
});
