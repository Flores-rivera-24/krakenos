import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { en } from '@/lib/i18n/catalog/en';
import { es } from '@/lib/i18n/catalog/es';
import { ficheros, nombreDe, sinComentariosConLineas } from './_fuentes';

/**
 * Gate: ningún glifo ni emoji hace de icono en el código ni en el catálogo.
 *
 * Un `✓`, un `✕`, un `●` o un `🔌` no es un icono: lo dibuja la fuente del sistema (cambia de
 * aparato en aparato y de tema a tema), no hereda el color con el contraste medido, y el lector
 * de pantalla lo lee como «marca de verificación» o no lo lee. El set es lucide-react, a 20 px,
 * con `aria-hidden` si un texto ya nombra la cosa o con nombre accesible si no.
 *
 * Mira el **código** (sin comentarios: explicar la regla no delata al fichero) y los **valores**
 * del catálogo, que es donde se esconde el copy. `EXCEPCIONES` va vacía a propósito.
 */

const GLIFO = /[\p{Extended_Pictographic}✓✔✕✖✗✘●○]/gu;

const MENSAJE =
  'Un glifo no es un icono: usa lucide-react (único set) a 20 px con `aria-hidden` o un nombre accesible';

/** Cuántos glifos o emoji contiene un texto. */
function contarGlifos(texto: string): number {
  return texto.match(GLIFO)?.length ?? 0;
}

/** Por fichero (relativo a `src/`) y con su porqué. Vacía a propósito. */
const EXCEPCIONES: Record<string, string> = {};

describe('glifos y emoji', () => {
  it('control positivo: cuenta lo que debe y deja pasar lo que no es un glifo', () => {
    expect(contarGlifos("const x = '🏠';")).toBe(1);
    expect(contarGlifos('<span>✕</span>')).toBe(1);
    expect(contarGlifos("'●'")).toBe(1);
    expect(contarGlifos('✓ Conectado')).toBe(1);
    expect(contarGlifos(sinComentariosConLineas('// ⚠️ nota\nconst a = 1;'))).toBe(0);
    expect(contarGlifos("'·'")).toBe(0);
    expect(contarGlifos("'•••'")).toBe(0);
  });

  const rutas = ficheros().filter((r) => !nombreDe(r).startsWith('lib/i18n/catalog/'));

  it('guard: encuentra el árbol y los catálogos; si el recorrido se rompe no pasa en vacío', () => {
    expect(rutas.length).toBeGreaterThan(150);
    expect(Object.keys(es).length).toBeGreaterThan(1000);
    expect(Object.keys(en).length).toBeGreaterThan(1000);
    expect(Object.keys(es).length).toBe(Object.keys(en).length);
  });

  it('el código de src/ no pinta glifos ni emoji', () => {
    const hallazgos: string[] = [];
    for (const ruta of rutas) {
      const nombre = nombreDe(ruta);
      if (nombre in EXCEPCIONES) continue;
      sinComentariosConLineas(readFileSync(ruta, 'utf8'))
        .split('\n')
        .forEach((linea, i) => {
          if (contarGlifos(linea) > 0) hallazgos.push(`${nombre}:${i + 1}  ${linea.trim()}`);
        });
    }
    expect(hallazgos, MENSAJE).toEqual([]);
  });

  it.each([
    ['es', es as Record<string, string>],
    ['en', en as Record<string, string>],
  ])('los valores del catálogo %s no llevan glifos ni emoji', (_, catalogo) => {
    const hallazgos = Object.entries(catalogo)
      .filter(([, valor]) => contarGlifos(valor) > 0)
      .map(([clave, valor]) => `${clave}: ${valor}`);
    expect(hallazgos, MENSAJE).toEqual([]);
  });
});
