import { describe, expect, it } from 'vitest';
import { sunEventLocalMinutes, sunEventUtc } from '../../src/iot/solar.js';

/**
 * Cálculo solar local, sin red (`iot/solar.ts`). Vivía dentro del test del
 * evaluador de horarios IoT; al absorber esos horarios (US-256) el cálculo pasó
 * a alimentar el disparador solar del motor, así que su prueba se queda con él
 * en vez de irse con el módulo retirado.
 *
 * La comprobación que importa es contra **efemérides reales**: una ecuación
 * astronómica mal transcrita no lanza, devuelve una hora plausible.
 */

const MADRID = { lat: 40.4168, lon: -3.7038 };

describe('iot/solar — contra efemérides', () => {
  it('amanecer/atardecer de Madrid en el solsticio de verano (±3 min)', () => {
    const sr = sunEventUtc(2026, 6, 21, MADRID.lat, MADRID.lon, 'sunrise');
    const ss = sunEventUtc(2026, 6, 21, MADRID.lat, MADRID.lon, 'sunset');
    expect(sr).not.toBeNull();
    expect(ss).not.toBeNull();
    // Efeméride: amanecer ~04:44Z, atardecer ~19:48Z.
    const srMin = (sr as Date).getUTCHours() * 60 + (sr as Date).getUTCMinutes();
    const ssMin = (ss as Date).getUTCHours() * 60 + (ss as Date).getUTCMinutes();
    expect(Math.abs(srMin - (4 * 60 + 44))).toBeLessThanOrEqual(3);
    expect(Math.abs(ssMin - (19 * 60 + 48))).toBeLessThanOrEqual(3);
  });

  it('el atardecer va DESPUÉS del amanecer el mismo día', () => {
    // Invertir el signo del ángulo horario es un error de una tecla que no da
    // ningún fallo: da un «amanecer» a las ocho de la tarde.
    const sr = sunEventUtc(2026, 3, 15, MADRID.lat, MADRID.lon, 'sunrise') as Date;
    const ss = sunEventUtc(2026, 3, 15, MADRID.lat, MADRID.lon, 'sunset') as Date;
    expect(ss.getTime()).toBeGreaterThan(sr.getTime());
  });

  it('devuelve null en noche polar (78°N en pleno invierno)', () => {
    expect(sunEventUtc(2026, 12, 21, 78, 15, 'sunrise')).toBeNull();
    expect(sunEventLocalMinutes(new Date(2026, 11, 21), 78, 15, 'sunset')).toBeNull();
  });

  it('los minutos locales caen dentro del día', () => {
    const m = sunEventLocalMinutes(new Date(2026, 6, 8), MADRID.lat, MADRID.lon, 'sunrise');
    expect(m).not.toBeNull();
    expect(m as number).toBeGreaterThanOrEqual(0);
    expect(m as number).toBeLessThanOrEqual(1439);
  });
});
