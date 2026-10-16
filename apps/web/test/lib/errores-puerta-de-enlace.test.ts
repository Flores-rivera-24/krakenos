import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ApiRequestError } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { ensureCatalog, setLocale } from '@/lib/i18n';
import { en } from '@/lib/i18n/catalog/en';
import { es } from '@/lib/i18n/catalog/es';

beforeAll(() => ensureCatalog('en'));
afterEach(() => setLocale('es', { persist: false }));

/**
 * Los tres códigos con los que el agente declara que VPN, cortafuegos o QoS no pueden
 * aplicarse en este equipo. En español el agente ya manda el copy (y `describeError` lo pinta
 * tal cual); en otro idioma se traduce por `code`. Los literales en español son los del agente
 * (`gateway-capability.ts`, `runner.ts`): si uno cambia, el test del otro lado lo dice.
 */
const CASOS = [
  {
    code: 'GATEWAY_UNSUPPORTED',
    status: 501,
    es: 'Este equipo no puede hacer de puerta de enlace (VPN, cortafuegos o QoS). Usa los de tu router.',
  },
  {
    code: 'GATEWAY_REQUIRES_SETUP',
    status: 503,
    es: 'Falta instalar el helper de puerta de enlace en este equipo: sin él no se puede aplicar el cambio.',
  },
  {
    code: 'PRIVILEGED_COMMAND_FAILED',
    status: 503,
    es: 'No se pudo aplicar el cambio en el sistema. El detalle está en el registro del servidor.',
  },
] as const;

describe.each(CASOS)('describeError: $code', (caso) => {
  const key = `errors.code.${caso.code}` as keyof typeof es;

  it('el catálogo en español es el copy del agente, verbatim', () => {
    expect(es[key]).toBe(caso.es);
  });

  it('en español se pinta el mensaje del agente', () => {
    const err = new ApiRequestError(caso.status, { code: caso.code, message: caso.es });
    expect(describeError(err, 'fallback')).toBe(caso.es);
  });

  it('en inglés se traduce por código, no se pinta el español del agente', () => {
    setLocale('en', { persist: false });
    const err = new ApiRequestError(caso.status, { code: caso.code, message: caso.es });
    const texto = describeError(err, 'fallback');
    expect(texto).toBe(en[key]);
    expect(texto).not.toBe(caso.es);
    expect(texto).not.toBe('fallback');
  });
});
