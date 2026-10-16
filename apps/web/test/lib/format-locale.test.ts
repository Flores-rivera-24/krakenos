import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  formatBytes,
  formatDate,
  formatDateTime,
  formatFixed,
  formatNumber,
  formatRate,
  formatRateCompact,
  formatTime,
  intlLocale,
  timeFromNow,
  timeUntil,
} from '@/lib/format';
import { changeLocale, setLocale } from '@/lib/i18n';

/**
 * Números y fechas en el idioma ACTIVO de la app, no en el del navegador. jsdom
 * declara `navigator.language === 'en-US'`: si algún formateador volviera a mirar
 * al navegador, las aserciones en español de abajo saldrían con punto decimal y
 * en formato de fecha norteamericano.
 */

// 14 de octubre de 2026, 20:53:28 en hora LOCAL (no depende de la zona del runner).
const INSTANTE = new Date(2026, 9, 14, 20, 53, 28);

beforeAll(async () => {
  await changeLocale('en', { persist: false });
  setLocale('es', { persist: false });
});

afterEach(() => {
  setLocale('es', { persist: false });
});

describe('números en el idioma activo', () => {
  it('es: coma decimal', () => {
    expect(intlLocale()).toBe('es-ES');
    expect(formatFixed(80, 1)).toBe('80,0');
    expect(formatRate(1_250_000)).toBe('10,0 Mbps');
    expect(formatBytes(1.5 * 1024 ** 3)).toBe('1,5 GB');
    expect(formatNumber(0.5, { maximumFractionDigits: 1 })).toBe('0,5');
  });

  it('en: punto decimal', () => {
    setLocale('en', { persist: false });
    expect(intlLocale()).toBe('en-US');
    expect(formatFixed(80, 1)).toBe('80.0');
    expect(formatRate(1_250_000)).toBe('10.0 Mbps');
    expect(formatBytes(1.5 * 1024 ** 3)).toBe('1.5 GB');
    expect(formatNumber(1234567)).toBe('1,234,567');
  });

  it('formatRateCompact cabe en una línea: «80M», nunca «80.0 Mbps»', () => {
    // 10 MB/s = 80 Mbps
    expect(formatRateCompact(10_000_000)).toBe('80M');
    expect(formatRateCompact(1_562_500)).toBe('12,5M'); // 12.5 Mbps
    expect(formatRateCompact(64_000)).toBe('512K');
    expect(formatRateCompact(0)).toBe('0');
    expect(formatRateCompact(250_000_000)).toBe('2G'); // 2 Gbps
    setLocale('en', { persist: false });
    expect(formatRateCompact(1_562_500)).toBe('12.5M');
  });
});

describe('fechas en el idioma activo', () => {
  it('es: día/mes/año y 24 h', () => {
    expect(formatDateTime(INSTANTE)).toBe('14/10/2026, 20:53:28');
    expect(formatDate(INSTANTE)).toBe('14/10/2026');
    expect(formatTime(INSTANTE)).toBe('20:53:28');
  });

  it('en: mes/día/año y 12 h, aunque el navegador sea otro', () => {
    setLocale('en', { persist: false });
    expect(formatDateTime(INSTANTE)).toMatch(/^10\/14\/2026, 8:53:28\sPM$/);
    expect(formatDate(INSTANTE)).toBe('10/14/2026');
    expect(formatTime(INSTANTE)).toMatch(/^8:53:28\sPM$/);
  });

  it('acepta un ISO y respeta las opciones', () => {
    expect(formatDate(INSTANTE.toISOString(), { day: '2-digit', month: 'short' })).toMatch(
      /^14 oct/,
    );
    setLocale('en', { persist: false });
    expect(formatDate(INSTANTE.toISOString(), { day: '2-digit', month: 'short' })).toBe('Oct 14');
  });
});

describe('tiempo relativo hacia el futuro', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-15T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const enMs = (ms: number) => new Date(Date.now() + ms).toISOString();
  const H = 3_600_000;

  it('una caducidad a 24 h dice «en 24 h», no «hace un momento»', () => {
    expect(timeUntil(enMs(24 * H))).toBe('en 24 h');
    // Leída unos segundos después de crearse, sigue diciendo 24 h (redondea).
    expect(timeUntil(enMs(24 * H - 5_000))).toBe('en 24 h');
    setLocale('en', { persist: false });
    expect(timeUntil(enMs(24 * H))).toBe('in 24 h');
  });

  it('escala a minutos, horas y días', () => {
    expect(timeUntil(enMs(20_000))).toBe('en un momento');
    expect(timeUntil(enMs(5 * 60_000))).toBe('en 5 min');
    expect(timeUntil(enMs(72 * H))).toBe('en 3 d');
    setLocale('en', { persist: false });
    expect(timeUntil(enMs(20_000))).toBe('in a moment');
    expect(timeUntil(enMs(5 * 60_000))).toBe('in 5 min');
  });

  it('timeFromNow elige la dirección: futuro → «en», pasado → «hace»', () => {
    expect(timeFromNow(enMs(24 * H))).toBe('en 24 h');
    expect(timeFromNow(enMs(-3 * H))).toBe('hace 3h');
    setLocale('en', { persist: false });
    expect(timeFromNow(enMs(24 * H))).toBe('in 24 h');
    expect(timeFromNow(enMs(-3 * H))).toBe('3h ago');
  });
});
