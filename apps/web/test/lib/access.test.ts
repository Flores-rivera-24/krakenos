import { describe, expect, it } from 'vitest';
import { hhmmToMinutes, minutesToHHMM } from '@/lib/access';

describe('access — conversión de tiempo (US-108)', () => {
  it('minutos → HH:MM', () => {
    expect(minutesToHHMM(0)).toBe('00:00');
    expect(minutesToHHMM(75)).toBe('01:15');
    expect(minutesToHHMM(21 * 60)).toBe('21:00');
    expect(minutesToHHMM(1439)).toBe('23:59');
  });

  it('HH:MM → minutos', () => {
    expect(hhmmToMinutes('00:00')).toBe(0);
    expect(hhmmToMinutes('07:30')).toBe(450);
    expect(hhmmToMinutes('23:59')).toBe(1439);
  });
});
