import { describe, expect, it } from 'vitest';
import { en } from '@/lib/i18n/catalog/en';
import { es } from '@/lib/i18n/catalog/es';

/**
 * Concordancia de número COMPUTADA, no «dispositivo(s)» ni «1 llamadas»
 * (`docs/copy-style.md` → Accesibilidad). Una cifra que acompaña a un sustantivo
 * lleva dos claves (`.one`/`.other`) elegidas con `plural()`.
 *
 * Solo se tolera el patrón `palabra(s)` en los toasts de resultado parcial ya
 * establecidos; la lista es cerrada, lleva el porqué y falla si queda obsoleta.
 */

const TOLERADAS: Record<string, string> = {
  'rooms.actionPartial': 'toast de resultado parcial («N aplicado(s), M sin responder»)',
  'scenes.actionPartial': 'toast de resultado parcial («N aplicado(s), M sin responder»)',
  'scenes.partial': 'toast de resultado parcial («N aplicado(s), M sin responder»)',
};

// «dispositivo(s)», «encendido(s)», «punto(s)», «device(s)». No casa «Intervalo (s)»,
// que es una unidad (segundos) con espacio delante.
const PLURAL_ENTRE_PARENTESIS = /[\p{L}]\((?:s|es)\)/u;

function ofensores(catalogo: Record<string, string>): string[] {
  return Object.entries(catalogo)
    .filter(([clave, valor]) => PLURAL_ENTRE_PARENTESIS.test(valor) && !(clave in TOLERADAS))
    .map(([clave, valor]) => `${clave}: ${valor}`);
}

describe('plurales computados en el catálogo', () => {
  it('ningún «(s)» fuera de los toasts parciales, en es ni en en', () => {
    expect(ofensores(es)).toEqual([]);
    expect(ofensores(en)).toEqual([]);
  });

  it('la allowlist no está obsoleta: cada clave sigue teniendo el patrón', () => {
    for (const clave of Object.keys(TOLERADAS)) {
      expect(
        PLURAL_ENTRE_PARENTESIS.test((es as Record<string, string>)[clave] ?? ''),
        `${clave} ya no usa «(s)»: quítalo de la allowlist`,
      ).toBe(true);
    }
  });

  it('control positivo: el detector caza el patrón y deja pasar las unidades', () => {
    expect(ofensores({ x: '{n} dispositivo(s)' })).toHaveLength(1);
    expect(ofensores({ x: '{n} device(s)' })).toHaveLength(1);
    expect(ofensores({ x: 'con {aps} punto(s) de acceso' })).toHaveLength(1);
    expect(ofensores({ x: 'Intervalo (s)' })).toEqual([]);
    expect(ofensores({ 'rooms.actionPartial': '{n} aplicado(s)' })).toEqual([]);
  });

  it('cada par .one/.other existe en los dos idiomas y son distintos en es', () => {
    const bases = [
      'settings.health.opsCount',
      'rooms.onCount',
      'scenes.deviceCount',
      'wellbeing.devices',
      'coverage.plan.aria',
    ];
    for (const base of bases) {
      for (const cat of [es, en] as Record<string, string>[]) {
        expect(cat[`${base}.one`], `${base}.one`).toBeTruthy();
        expect(cat[`${base}.other`], `${base}.other`).toBeTruthy();
      }
      expect((es as Record<string, string>)[`${base}.one`]).not.toBe(
        (es as Record<string, string>)[`${base}.other`],
      );
    }
  });
});
