import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ApiRequestError } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { ensureCatalog, setLocale } from '@/lib/i18n';

beforeAll(() => ensureCatalog('en'));
afterEach(() => setLocale('es', { persist: false }));

/** El 400 de validación del agente: `VALIDATION` + `details {field, rule, limit?}`, sin texto de Ajv. */
function validacion(details: Record<string, unknown>): ApiRequestError {
  return new ApiRequestError(400, {
    code: 'VALIDATION',
    message: 'Algunos datos no son válidos. Revisa el formulario.',
    details,
  });
}

const CASOS = [
  {
    nombre: 'vacío o ausente',
    details: { field: 'name', rule: 'minLength', limit: 1 },
    es: 'Falta un dato obligatorio. Revisa que no haya campos vacíos.',
    en: 'A required field is missing. Check that no field is empty.',
  },
  {
    nombre: 'propiedad requerida',
    details: { field: 'name', rule: 'required' },
    es: 'Falta un dato obligatorio. Revisa que no haya campos vacíos.',
    en: 'A required field is missing. Check that no field is empty.',
  },
  {
    nombre: 'demasiado corto',
    details: { field: 'pin', rule: 'minLength', limit: 4 },
    es: 'Un dato es demasiado corto: debe tener al menos 4 caracteres.',
    en: 'A field is too short: it needs at least 4 characters.',
  },
  {
    nombre: 'demasiado largo',
    details: { field: 'name', rule: 'maxLength', limit: 80 },
    es: 'Un dato es demasiado largo: admite como máximo 80 caracteres.',
    en: 'A field is too long: it allows at most 80 characters.',
  },
  {
    nombre: 'cualquier otra regla',
    details: { field: 'ip', rule: 'format' },
    es: 'Algunos datos no son válidos. Revisa el formulario.',
    en: 'Some details are not valid. Check the form.',
  },
] as const;

describe('describeError con el 400 de validación', () => {
  for (const c of CASOS) {
    it(`${c.nombre}: en español`, () => {
      expect(describeError(validacion(c.details), 'No se pudo guardar')).toBe(c.es);
    });
    it(`${c.nombre}: en inglés, sin el español ni el nombre técnico del campo`, () => {
      setLocale('en', { persist: false });
      const msg = describeError(validacion(c.details), 'Could not save');
      expect(msg).toBe(c.en);
      expect(msg).not.toMatch(/must NOT|body\/|Revisa/);
    });
  }

  it('sin details (agente antiguo): cae al mensaje genérico traducido', () => {
    setLocale('en', { persist: false });
    const err = new ApiRequestError(400, { code: 'VALIDATION', message: 'x' });
    expect(describeError(err, 'Could not save')).toBe(
      'Some details are not valid. Check the form.',
    );
  });
});
