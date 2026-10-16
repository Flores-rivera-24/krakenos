import { AUDIT_ACTIONS } from '@krakenos/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ETIQUETA_DE_ACCION, etiquetaDeAccion } from '@/lib/audit-actions';
import { ensureCatalog, setLocale, t } from '@/lib/i18n';
import { en } from '@/lib/i18n/catalog/en';
import { es } from '@/lib/i18n/catalog/es';

/**
 * Cada acción de auditoría se enseña con su texto, en los dos idiomas. El tipo
 * (`Record<AuditAction, …>`) impide que falte una entrada; este test ata lo que el tipo
 * no ve: que la CLAVE exista en los catálogos y que el texto resultante no sea la propia
 * clave ni el identificador crudo (`auth.login`).
 */
describe('texto de las acciones de auditoría', () => {
  beforeAll(() => ensureCatalog('en'));
  afterAll(() => setLocale('es', { persist: false }));

  it('guard: hay acciones que comprobar', () => {
    expect(AUDIT_ACTIONS.length).toBeGreaterThan(100);
  });

  it.each(['es', 'en'] as const)('ninguna acción pinta su clave ni su id crudo en %s', (idioma) => {
    setLocale(idioma, { persist: false });
    const catalogo: Record<string, string> = idioma === 'es' ? es : en;
    for (const accion of AUDIT_ACTIONS) {
      const clave = ETIQUETA_DE_ACCION[accion];
      expect(catalogo[clave], `${idioma}:${clave}`).toBeTruthy();
      const texto = etiquetaDeAccion(accion, t);
      expect(texto, accion).not.toBe(clave);
      expect(texto, accion).not.toBe(accion);
      expect(texto, accion).not.toMatch(/^[a-z]+(\.[a-z_-]+)+$/);
      expect(texto, accion).not.toMatch(/\{\w+\}/);
    }
  });

  it('en español conserva los textos acordados («Inicio de sesión», «Dispositivo bloqueado»)', () => {
    setLocale('es', { persist: false });
    expect(etiquetaDeAccion('auth.login', t)).toBe('Inicio de sesión');
    expect(etiquetaDeAccion('device.block', t)).toBe('Dispositivo bloqueado');
  });

  it('una acción que esta versión no conoce se DECLARA (la tabla conserva filas viejas)', () => {
    setLocale('es', { persist: false });
    expect(etiquetaDeAccion('zz.vieja', t)).toBe('Acción no reconocida (zz.vieja)');
    // Ni un valor heredado del prototipo se cuela como acción.
    expect(etiquetaDeAccion('constructor', t)).toBe('Acción no reconocida (constructor)');
    setLocale('en', { persist: false });
    expect(etiquetaDeAccion('zz.vieja', t)).toBe('Unrecognized action (zz.vieja)');
  });
});
