import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { ficheros, nombreDe } from './_fuentes';

/**
 * Gate: ningún TEXTO de JSX (lo que va entre etiquetas) está escrito a pelo.
 *
 * ## Por qué existe, si ya hay `copy-sin-traducir`
 *
 * Aquel detector reconoce el español por acentos o palabras funcionales y solo
 * mira texto que EMPIEZA en mayúscula y cabe entre `>` y `<` en una línea. Así que
 * no veía `Clientes`, `Banda`, `Cerrar`, `Entendido` ni `· hecho`: palabras sueltas
 * sin tilde, o texto pegado a una `{expresión}`. Con la interfaz en inglés seguían
 * saliendo en español (barrido post-merge de las issues #91–#93).
 *
 * Este no adivina el idioma: lee el árbol sintáctico y trata como copy cualquier
 * nodo de texto de JSX con letras. Lo que de verdad no es copy (siglas, marcas,
 * unidades) se reconoce por dos vías:
 *  - una SIGLA (todo mayúsculas/dígitos: `SSID`, `AP`, `VLAN`) no es copy;
 *  - lo demás va en `RETENIDOS`, con su porqué. Es la lista de «términos retenidos»
 *    de `docs/copy-style.md`: se compara por VALOR, no por fichero, porque el
 *    término es el mismo en cualquier pantalla.
 *
 * Alcance honesto: lee el nodo de texto de JSX, no lo que llega por una variable
 * (`{etiqueta}`) ni por un literal dentro de una `{expresión}`; esos huecos los
 * cubren `atributos-literales`, `fila-abrible-literal` y la revisión.
 */

/** Términos que NO se traducen (valor tal cual aparece en el JSX, ya recortado). */
const RETENIDOS: Record<string, string> = {
  KrakenOS: 'nombre de marca',
  WireGuard: 'nombre de producto (término retenido de VPN)',
  WiFi: 'término retenido (copy-style)',
  IoT: 'término retenido (copy-style)',
  Uptime: 'jerga deliberada de modo avanzado (copy-style)',
  'Device ID': 'campo de la cuenta de Tuya, tal como lo llama el fabricante',
  'Local Key': 'campo de la cuenta de Tuya, tal como lo llama el fabricante',
  '(tag': 'primera mitad de «(tag N)»: «tag» es el término técnico de VLAN en ambos idiomas',
};

/**
 * Unidades que acompañan a un número (`{n}s ·`, `{ms} ms`, `{dbm} dBm`): se comparan
 * por sus LETRAS, sin los signos que las rodean, y son iguales en ambos idiomas.
 */
const UNIDADES = new Set(['s', 'ms', 'dBm']);

export interface Hallazgo {
  texto: string;
  linea: number;
}

/** ¿Es una sigla (`SSID`, `URL RTSP`, `AP`)? Sin ninguna minúscula, hay letras. */
function esSigla(texto: string): boolean {
  return /\p{L}/u.test(texto) && !/\p{Ll}/u.test(texto);
}

/** Nodos de texto de JSX con letras, en el código de un fichero `.tsx`. */
export function textosDeJsx(nombre: string, fuente: string): Hallazgo[] {
  const sf = ts.createSourceFile(nombre, fuente, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const salida: Hallazgo[] = [];
  const visitar = (nodo: ts.Node): void => {
    if (ts.isJsxText(nodo)) {
      const texto = nodo.text.replace(/\s+/g, ' ').trim();
      if (/\p{L}/u.test(texto)) {
        // El nodo empieza en el salto de línea que sigue a `>`: la línea que importa es
        // la de la primera letra visible.
        const inicio = nodo.getStart() + (nodo.text.length - nodo.text.trimStart().length);
        salida.push({ texto, linea: sf.getLineAndCharacterOfPosition(inicio).line + 1 });
      }
    }
    ts.forEachChild(nodo, visitar);
  };
  visitar(sf);
  return salida;
}

function esCopy(texto: string): boolean {
  return !esSigla(texto) && !(texto in RETENIDOS) && !UNIDADES.has(texto.replace(/[^\p{L}]/gu, ''));
}

function escanear(): { nombre: string; texto: string; linea: number }[] {
  const salida: { nombre: string; texto: string; linea: number }[] = [];
  for (const ruta of ficheros()) {
    if (!ruta.endsWith('.tsx')) continue;
    const nombre = nombreDe(ruta);
    for (const h of textosDeJsx(nombre, readFileSync(ruta, 'utf8'))) {
      salida.push({ nombre, ...h });
    }
  }
  return salida;
}

/**
 * Control positivo SINTÉTICO: no depende de cuánta deuda quede. Cubre las formas
 * que se escapaban (una palabra sola, texto pegado a una expresión, mayúscula
 * inicial o no) y las que NO deben contar (sigla, término retenido, comentario,
 * texto de un atributo, `t(...)`).
 */
const MUESTRA = [
  '// <p>En un comentario</p>',
  'const a = <th>Clientes</th>;',
  'const b = <span>{n} en línea</span>;',
  'const c = <span className="x">· hecho</span>;',
  'const d = <Button>Cerrar</Button>;',
  'const e = <th>SSID</th>;',
  'const f = <b>KrakenOS</b>;',
  'const g = <p aria-label="Cerrar">{t("clave")}</p>;',
  'const h = <p>',
  '  Texto en',
  '  dos líneas',
  '</p>;',
].join('\n');

describe('texto de JSX con literal a pelo', () => {
  it('el barrido encuentra el árbol', () => {
    expect(ficheros().filter((f) => f.endsWith('.tsx')).length).toBeGreaterThan(100);
  });

  it('el detector sigue detectando, con su línea (control positivo)', () => {
    expect(
      textosDeJsx('muestra.tsx', MUESTRA)
        .filter((h) => esCopy(h.texto))
        .map((h) => `${h.linea}:${h.texto}`),
    ).toEqual(['2:Clientes', '3:en línea', '4:· hecho', '5:Cerrar', '10:Texto en dos líneas']);
  });

  it('ningún componente escribe texto de JSX a pelo', () => {
    const culpables = escanear()
      .filter((h) => esCopy(h.texto))
      .map((h) => `${h.nombre}:${h.linea}  «${h.texto}»`);
    expect(
      culpables,
      'Texto escrito a pelo entre etiquetas JSX: con la interfaz en inglés sale en ' +
        'español. Muévelo al fragmento de su pantalla (`catalog/fragments/`) y `catalog/en.ts` y píntalo con `t()`. Si NO ' +
        'es copy (marca, sigla, unidad), añádelo a `RETENIDOS` con el motivo.',
    ).toEqual([]);
  });

  it('la lista de retenidos y de unidades no tiene entradas obsoletas', () => {
    const textos = escanear().map((h) => h.texto);
    const vistos = new Set(textos);
    const letras = new Set(textos.map((t) => t.replace(/[^\p{L}]/gu, '')));
    const obsoletos = [
      ...Object.keys(RETENIDOS).filter((k) => !vistos.has(k)),
      ...[...UNIDADES].filter((u) => !letras.has(u)),
    ];
    expect(
      obsoletos,
      'Entradas de `RETENIDOS`/`UNIDADES` que ya no aparecen como texto de JSX: quítalas (una ' +
        'allowlist que sobra es permiso para volver a meter copy).',
    ).toEqual([]);
  });
});
