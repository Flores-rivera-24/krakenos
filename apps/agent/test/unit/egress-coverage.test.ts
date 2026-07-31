import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Gate de cobertura del egress (US-259).
 *
 * `CLAUDE.md` lleva declarando desde la Fase 4 que «toda petición saliente nueva
 * pasa por `safeFetch`», y aun así **nueve** transportes llamaban al `fetch`
 * global. Peor: la lista de los nueve se enumeró **a mano** en dos auditorías
 * seguidas y las dos veces salió corta —`shelly` no apareció en ninguna—, así que
 * el invariante no solo se incumplía: se creía cumplido en un 89 %.
 *
 * La lección no es «revisar mejor», es que un invariante sobre **todo el árbol**
 * no se sostiene con una lista escrita a mano. Este test deriva el alcance del
 * código: recorre `src/`, y si aparece una llamada al `fetch` global fuera de la
 * allowlist, falla nombrando el fichero.
 *
 * Qué NO hace: no vale como prueba de que `safeFetch` protege (eso lo hacen los
 * tests de efecto observable de `egress.test.ts`). Este solo garantiza que la
 * puerta existe en todas las paredes.
 */

const SRC = fileURLToPath(new URL('../../src', import.meta.url));

/**
 * `fetch(` en **posición de expresión**: tras `await`, `return`, `=>`, `=`, `(` o
 * `,`. Se afina así a propósito porque el árbol tiene métodos **llamados** `fetch`
 * que no son el global —`UpdateRunner.fetch(targetVersion)` es un paso del
 * pipeline de actualización—, y un patrón más laxo los marcaría a los dos. Un
 * falso positivo en un gate se acaba silenciando, y un gate silenciado no existe.
 *
 * ⚠️ El `\s` (y no `[ \t]`) es deliberado y lo impuso un fallo de este mismo test:
 * el transporte de Shelly es `const f: T = (url, init) =>\n  fetch(url, init)`, con
 * el `=>` en la línea **anterior**. Escaneando línea a línea, el gate daba verde
 * con la regresión puesta — la misma omisión multilínea que dejó a `shelly` fuera
 * de la lista de nueve escrita a mano. Por eso se busca sobre el fichero entero.
 *
 * `safeFetch(` no casa por construcción: el carácter anterior a `fetch(` sería `e`,
 * que no está entre los operadores.
 */
const LLAMADA_A_FETCH_GLOBAL = /(await|return|=>|[=(,])\s*fetch\(/g;

/** Quita comentarios de bloque y de línea para no marcar un `fetch(` citado en prosa. */
function sinComentarios(src: string): string {
  // Se sustituyen por espacios (no se borran) para conservar los offsets y poder
  // seguir calculando el número de línea real de cada hallazgo.
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
}

/**
 * Único fichero autorizado a llamar al `fetch` global: es quien lo envuelve. Si
 * esta lista crece, la razón se escribe aquí — no se añade y ya.
 */
const ALLOWLIST = new Set(['net/egress.ts']);

function ficherosTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...ficherosTs(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('cobertura de egress: nadie llama al fetch global (US-259)', () => {
  const ficheros = ficherosTs(SRC);

  it('recorre un árbol de tamaño creíble', () => {
    // Guard obligatorio de todo meta-test que recolecta: si la recolección se
    // rompe, la lista sale vacía y el test pasa en verde sin comprobar nada.
    expect(ficheros.length).toBeGreaterThan(150);
  });

  it('ningún módulo fuera de `net/egress.ts` usa el fetch global', () => {
    const infractores: string[] = [];

    for (const file of ficheros) {
      const rel = relative(SRC, file).split('\\').join('/');
      if (ALLOWLIST.has(rel)) continue;

      const src = sinComentarios(readFileSync(file, 'utf8'));
      for (const m of src.matchAll(LLAMADA_A_FETCH_GLOBAL)) {
        // Línea real a partir del offset: el hallazgo tiene que ser accionable.
        const linea = src.slice(0, m.index).split('\n').length;
        infractores.push(`${rel}:${linea}`);
      }
    }

    // Mensaje accionable: el fallo dice qué fichero y qué línea, para que el
    // arreglo sea cambiar `fetch(` por `safeFetch(` y no una cacería.
    expect(infractores).toEqual([]);
  });

  it('la allowlist sigue siendo el envoltorio y nada más', () => {
    // Sin esto, «arreglar» un fallo futuro metiendo el fichero en la allowlist
    // pasaría desapercibido: el test de arriba volvería a verde solo.
    expect([...ALLOWLIST]).toEqual(['net/egress.ts']);
  });
});
