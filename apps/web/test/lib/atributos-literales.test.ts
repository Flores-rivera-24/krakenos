import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SRC, ficheros, sinComentariosConLineas } from './_fuentes';

/**
 * Gate: ningún atributo accesible o de texto lleva un LITERAL a pelo.
 *
 * ## Por qué existe, si ya hay `copy-sin-traducir`
 *
 * Aquel detector reconoce el español por acentos o palabras funcionales, así que
 * no ve `aria-label="Cerrar"` ni `aria-label="Tendencia"`: una sola palabra sin
 * tilde. Con la interfaz en inglés, el lector de pantalla seguía diciendo
 * «Cerrar» en el botón de todos los slideovers (issue #88).
 *
 * Este no adivina el idioma: cualquier valor literal de `aria-label`,
 * `placeholder`, `title` o `alt` que lleve letras es **texto de cara a una
 * persona** y va por `t()`. Lo que de verdad no es copy (un formato técnico, un
 * nombre de marca) se declara en `PERMITIDOS`, con el porqué.
 *
 * Alcance honesto: solo ve literales **simples** (`attr="x"`, `attr={'x'}` o
 * `attr={`x`}` sin interpolación). Una plantilla con `${…}` queda fuera: separar
 * en ella lo traducible de lo que no es otra cosa que adivinar.
 */

const ATRIBUTOS = ['aria-label', 'placeholder', 'title', 'alt'] as const;

/**
 * `(?<![\w-])` evita casar `data-title=` o `aria-labelledby=`; el valor es una
 * cadena entre comillas, dentro o no de llaves. `\s*` tolera que Prettier parta
 * el atributo en su propia línea. Las plantillas con `${` no casan.
 */
const LITERAL = new RegExp(
  String.raw`(?<![\w-])(${ATRIBUTOS.join('|')})\s*=\s*(?:\{\s*)?(?:"([^"\n]*)"|'([^'\n]*)'|` +
    '`([^`$\\n]*)`' +
    String.raw`)`,
  'g',
);

export interface Hallazgo {
  atributo: string;
  valor: string;
  linea: number;
}

/** Literales de atributo con texto (al menos una letra) en un código ya sin comentarios. */
export function literalesDeAtributo(codigo: string): Hallazgo[] {
  const salida: Hallazgo[] = [];
  LITERAL.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LITERAL.exec(codigo)) !== null) {
    const valor = (m[2] ?? m[3] ?? m[4] ?? '').trim();
    if (!/\p{L}/u.test(valor)) continue; // `alt=""`, `placeholder="0"`: no hay texto
    const linea = codigo.slice(0, m.index).split('\n').length;
    salida.push({ atributo: m[1]!, valor, linea });
  }
  return salida;
}

/**
 * Literales que NO son copy. Clave `ruta relativa a src/ | valor`; el motivo va
 * al lado. Una entrada que ya no casa con nada hace fallar el test: una allowlist
 * obsoleta es sitio libre para volver a meter copy.
 */
const PERMITIDOS: Record<string, string> = {
  'components/firewall/FirewallRuleSlideover.tsx|IP/CIDR/MAC':
    'formato técnico de un campo de dirección; no se traduce',
  'components/firewall/FirewallRuleSlideover.tsx|IP/CIDR/host':
    'formato técnico de un campo de dirección; no se traduce',
  'components/settings/IntegrationsSection.tsx|Philips Hue': 'nombre de marca',
  'components/settings/IntegrationsSection.tsx|Govee': 'nombre de marca',
  'components/settings/IntegrationsSection.tsx|Tuya': 'nombre de marca',
  'pages/LoginPage.tsx|xxxxx-xxxxx-xxxxx-xxxxx':
    'máscara del código de recuperación: muestra el formato, no es una palabra',
  'components/settings/TuyaManager.tsx|192.168.1.x': 'ejemplo de dirección IP',
  'components/settings/MqttInteropCard.tsx|mqtt://192.168.1.10:1883': 'ejemplo de URL de broker',
};

function escanear(): { clave: string; texto: string }[] {
  const salida: { clave: string; texto: string }[] = [];
  for (const ruta of ficheros()) {
    const nombre = ruta.slice(SRC.length + 1);
    if (nombre.includes('lib/i18n/catalog/') || nombre.includes('lib/guides/')) continue;
    const codigo = sinComentariosConLineas(readFileSync(ruta, 'utf8'));
    for (const h of literalesDeAtributo(codigo)) {
      salida.push({
        clave: `${nombre}|${h.valor}`,
        texto: `${nombre}:${h.linea}  ${h.atributo}="${h.valor}"`,
      });
    }
  }
  return salida;
}

/**
 * Control positivo SINTÉTICO: no depende de cuánta deuda quede en el árbol, así
 * que no se pone rojo al terminar de pagarla. Cubre las formas que se escriben de
 * verdad y las que NO deben contar (comentario, `alt` vacío, número, plantilla,
 * atributo con el mismo sufijo).
 */
const MUESTRA = [
  '// <button aria-label="En un comentario" />',
  '/* <img',
  '     alt="En un bloque" /> */',
  'const a = <button aria-label="Cerrar" />;',
  'const b = <Input',
  '  placeholder=',
  '  "Nombre del hogar"',
  '/>;',
  "const c = <svg title={'Tendencia'} />;",
  'const d = <svg title={`Sin interpolar`} />;',
  'const e = <img alt="" />;',
  'const f = <Input placeholder="0.15" />;',
  'const g = <b aria-label={`Activar ${nombre}`} />;',
  'const h = <p data-title="no cuenta" aria-labelledby="tampoco" />;',
  'const i = <p aria-label={t("clave")} />;',
].join('\n');

describe('atributos con literal a pelo (issue #88)', () => {
  it('el barrido encuentra el árbol', () => {
    // Sin este guard, romper el recorrido dejaría la lista vacía y el test de abajo
    // pasaría sin haber mirado nada.
    expect(ficheros().length).toBeGreaterThan(100);
  });

  it('el detector sigue detectando, con el número de línea correcto (control positivo)', () => {
    const codigo = sinComentariosConLineas(MUESTRA);
    expect(literalesDeAtributo(codigo)).toEqual([
      { atributo: 'aria-label', valor: 'Cerrar', linea: 4 },
      { atributo: 'placeholder', valor: 'Nombre del hogar', linea: 6 },
      { atributo: 'title', valor: 'Tendencia', linea: 9 },
      { atributo: 'title', valor: 'Sin interpolar', linea: 10 },
    ]);
  });

  it('ningún atributo escribe copy a pelo', () => {
    const noPermitidos = escanear()
      .filter((h) => !(h.clave in PERMITIDOS))
      .map((h) => h.texto);
    expect(
      noPermitidos,
      'Un `aria-label`, `placeholder`, `title` o `alt` con texto a pelo se anuncia en ' +
        'español aunque la interfaz esté en inglés. Muévelo a `catalog/es.ts` y ' +
        '`catalog/en.ts` y píntalo con `t()`. Si NO es copy (formato técnico, marca), ' +
        'añádelo a `PERMITIDOS` con el motivo.',
    ).toEqual([]);
  });

  it('la lista de permitidos no tiene entradas obsoletas', () => {
    const vistas = new Set(escanear().map((h) => h.clave));
    const obsoletas = Object.keys(PERMITIDOS).filter((k) => !vistas.has(k));
    expect(
      obsoletas,
      'Entradas de `PERMITIDOS` que ya no casan con ningún literal: quítalas (una ' +
        'allowlist que sobra es permiso para volver a meter copy).',
    ).toEqual([]);
  });
});
