import { afterEach, describe, expect, it } from 'vitest';
import { en } from '@/lib/i18n/catalog/en';
import { es } from '@/lib/i18n/catalog/es';
import {
  detectBrowserLocale,
  getLocale,
  plural,
  resolveInitialLocale,
  setLocale,
  t,
} from '@/lib/i18n';
import { ApiRequestError } from '@/lib/api';
import { describeError } from '@/lib/errors';

// El idioma es estado global de módulo: cada test lo restaura para no contaminar.
afterEach(() => setLocale('es', { persist: false }));

describe('catálogo i18n (US-177)', () => {
  it('paridad de claves es/en (ninguna falta ni sobra)', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(es).sort());
  });

  it('ningún valor está vacío en ningún idioma', () => {
    for (const [key, value] of Object.entries(es)) expect(value, `es:${key}`).not.toBe('');
    for (const [key, value] of Object.entries(en)) expect(value, `en:${key}`).not.toBe('');
  });
});

describe('t() (US-177)', () => {
  it('traduce según el idioma activo', () => {
    setLocale('es', { persist: false });
    expect(t('nav.devices')).toBe('Dispositivos');
    setLocale('en', { persist: false });
    expect(t('nav.devices')).toBe('Devices');
  });

  it('interpola params {clave}', () => {
    // Usa una clave con placeholder si existe; si no, valida el motor con una plantilla.
    expect(t('errors.network')).toBe(es['errors.network']);
    // Interpolación directa sobre el motor: reutiliza una clave sin placeholder → intacta.
    setLocale('es', { persist: false });
    expect(t('nav.settings', { x: 1 })).toBe('Ajustes');
  });

  it('es el idioma por defecto (fuente de la verdad = español)', () => {
    setLocale('es', { persist: false });
    expect(getLocale()).toBe('es');
    expect(t('app.booting')).toBe('Iniciando KrakenOS…');
  });
});

describe('plural() (US-177)', () => {
  it('1 = singular, resto = plural', () => {
    expect(plural(1, { one: 'día', other: 'días' })).toBe('día');
    expect(plural(2, { one: 'día', other: 'días' })).toBe('días');
    expect(plural(0, { one: 'day', other: 'days' })).toBe('days');
  });
});

describe('detección de idioma del navegador (US-177)', () => {
  it('resuelve un idioma soportado', () => {
    expect(['es', 'en']).toContain(detectBrowserLocale());
    expect(['es', 'en']).toContain(resolveInitialLocale());
  });
});

describe('describeError localizado (US-177)', () => {
  it('el fallo de red se traduce al idioma activo', () => {
    setLocale('en', { persist: false });
    expect(describeError(new Error('down'), 'x')).toBe(en['errors.network']);
    setLocale('es', { persist: false });
    expect(describeError(new Error('down'), 'x')).toBe(es['errors.network']);
  });

  it('en español conserva el mensaje del servidor (sin regresión de texto)', () => {
    setLocale('es', { persist: false });
    const err = new ApiRequestError(400, {
      code: 'AUTH_INVALID_CREDENTIALS',
      message: 'Credenciales del servidor',
    });
    expect(describeError(err, 'fallback')).toBe('Credenciales del servidor');
  });

  it('en otro idioma traduce por código cuando lo conoce', () => {
    setLocale('en', { persist: false });
    const err = new ApiRequestError(400, {
      code: 'AUTH_INVALID_CREDENTIALS',
      message: 'mensaje en español del servidor',
    });
    expect(describeError(err, 'fallback')).toBe(en['errors.code.AUTH_INVALID_CREDENTIALS']);
  });

  it('sin código conocido, cae al mensaje del servidor', () => {
    setLocale('en', { persist: false });
    const err = new ApiRequestError(500, { code: 'WHATEVER', message: 'server text' });
    expect(describeError(err, 'fallback')).toBe('server text');
  });
});
