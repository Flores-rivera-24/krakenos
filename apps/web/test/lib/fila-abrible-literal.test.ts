import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SRC, ficheros, sinComentariosConLineas } from './_fuentes';
import { literalesConTexto, llamadasA } from './_literales';

/**
 * Gate: la etiqueta de `filaAbrible(...)` no es un literal a pelo (issue #91).
 *
 * `filaAbrible(onOpen, etiqueta)` pone la etiqueta como `aria-label` de la fila.
 * Era un parámetro posicional, no un atributo JSX, así que `atributos-literales`
 * no lo veía: con la interfaz en inglés, el lector de pantalla anunciaba «Editar la
 * regla …» en cuatro tablas (firewall, tráfico, VPN, inventario).
 *
 * Mira el SEGUNDO argumento de cada llamada: si es una cadena o una plantilla con
 * texto (alguna letra fuera de los `${…}`) y no sale de `t(...)`, es copy a pelo.
 * Una llamada a `t('clave', { … })` no cuenta, ni los literales que haya dentro
 * del primer argumento (el callback).
 *
 * Alcance honesto: NO ve una etiqueta que llega por una variable
 * (`filaAbrible(abrir, etiqueta)`) ni una concatenación hecha antes de la llamada.
 * Hoy ninguna de las cuatro llamadas lo hace; si aparece una, la revisión es lo que
 * la caza. No hay allowlist: ninguna etiqueta de fila es un literal legítimo.
 */

interface Hallazgo {
  linea: number;
  etiqueta: string;
}

/** Etiquetas de `filaAbrible` con texto a pelo en un código ya sin comentarios. */
export function etiquetasConLiteral(codigo: string): Hallazgo[] {
  return llamadasA(codigo, 'filaAbrible').flatMap(({ args, linea }) => {
    const etiqueta = args[1];
    return etiqueta !== undefined && literalesConTexto(etiqueta).length > 0
      ? [{ linea, etiqueta }]
      : [];
  });
}

/**
 * Control positivo SINTÉTICO: no depende de cuántas filas haya hoy en el árbol.
 * Cubre las formas que se escriben de verdad (literal, plantilla, ternario, llamada
 * partida por Prettier) y las que NO deben contar (`t(...)`, comentario, la propia
 * declaración y un literal dentro del callback).
 */
const MUESTRA = [
  '// {...filaAbrible(() => a(), "En un comentario")}',
  'function filaAbrible(onOpen: () => void, etiqueta: string) {}',
  '<tr {...filaAbrible(() => open(r), `Editar la regla ${r.name}`)} />;',
  "<tr {...filaAbrible(() => open(r), 'Ver')} />;",
  '<tr {...filaAbrible(',
  '  () => open(r),',
  "  ok ? 'Abrir' : t('k'),",
  ')} />;',
  "<tr {...filaAbrible(() => go('x-y', 1), t('inventory.rowAria', { name: r.nombre }))} />;",
  '<tr {...filaAbrible(() => go(), `${a}/${b}`)} />;',
].join('\n');

describe('etiqueta de filaAbrible con literal a pelo (issue #91)', () => {
  it('el barrido encuentra las llamadas del árbol', () => {
    // Sin este guard, un recorrido o un parser rotos dejarían la lista vacía y el
    // test de abajo pasaría sin haber mirado nada.
    let llamadas = 0;
    for (const ruta of ficheros()) {
      llamadas += llamadasA(
        sinComentariosConLineas(readFileSync(ruta, 'utf8')),
        'filaAbrible',
      ).length;
    }
    expect(llamadas).toBeGreaterThanOrEqual(4);
  });

  it('el detector sigue detectando, con la línea correcta (control positivo)', () => {
    expect(etiquetasConLiteral(sinComentariosConLineas(MUESTRA))).toEqual([
      { linea: 3, etiqueta: '`Editar la regla ${r.name}`' },
      { linea: 4, etiqueta: "'Ver'" },
      { linea: 5, etiqueta: "ok ? 'Abrir' : t('k')" },
    ]);
  });

  it('ninguna fila abrible escribe su etiqueta a pelo', () => {
    const culpables: string[] = [];
    for (const ruta of ficheros()) {
      const nombre = ruta.slice(SRC.length + 1);
      if (nombre.includes('lib/i18n/catalog/') || nombre.includes('lib/guides/')) continue;
      const codigo = sinComentariosConLineas(readFileSync(ruta, 'utf8'));
      for (const h of etiquetasConLiteral(codigo)) {
        culpables.push(`${nombre}:${h.linea}  filaAbrible(…, ${h.etiqueta})`);
      }
    }
    expect(
      culpables,
      'La etiqueta de `filaAbrible` es el `aria-label` de la fila: con texto a pelo se ' +
        'anuncia en español aunque la interfaz esté en inglés. Muévela al fragmento de su pantalla (`catalog/fragments/`) y `catalog/en.ts` y pásala con `t(...)`.',
    ).toEqual([]);
  });
});
