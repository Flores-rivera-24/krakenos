import { t } from '@/lib/i18n';
import { describe, expect, it } from 'vitest';
import {
  diasCortos,
  formatSunOffset,
  minuteToTimeString,
  timeStringToMinute,
} from '@/lib/schedule-format';

/**
 * Formateo compartido por las superficies que programan algo. Heredado de
 * `lib/iot-schedules.ts`, que se fue con la API que absorbieron las rutinas.
 */

describe('minuteToTimeString / timeStringToMinute', () => {
  it('van y vuelven sin perder el minuto', () => {
    for (const m of [0, 1, 59, 60, 420, 1200, 1439]) {
      expect(timeStringToMinute(minuteToTimeString(m))).toBe(m);
    }
  });

  it('rellenan con cero a la izquierda', () => {
    expect(minuteToTimeString(0)).toBe('00:00');
    expect(minuteToTimeString(9 * 60 + 5)).toBe('09:05');
    expect(minuteToTimeString(1439)).toBe('23:59');
  });

  it('una hora ilegible no explota: cae a 0', () => {
    expect(timeStringToMinute('')).toBe(0);
    expect(timeStringToMinute('no es una hora')).toBe(0);
  });
});

describe('formatSunOffset', () => {
  it('sin desfase nombra solo el suceso', () => {
    expect(formatSunOffset('sunrise', 0, t)).toBe('Amanecer');
    expect(formatSunOffset('sunset', 0, t)).toBe('Atardecer');
  });

  it('el signo se ve, y el negativo va con el menos tipográfico', () => {
    expect(formatSunOffset('sunset', -15, t)).toBe('Atardecer −15 min');
    expect(formatSunOffset('sunrise', 30, t)).toBe('Amanecer +30 min');
  });
});

describe('diasCortos', () => {
  it('tiene los siete días empezando en domingo', () => {
    // El contrato usa 0=domingo en todas partes (horarios, rutinas, parental):
    // desplazarlo un puesto movería cada regla del usuario un día.
    expect(diasCortos(t)).toHaveLength(7);
    expect(diasCortos(t)[0]).toBe('Dom');
    expect(diasCortos(t)[6]).toBe('Sáb');
  });
});
