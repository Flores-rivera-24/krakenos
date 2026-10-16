import { describe, expect, it } from 'vitest';
import { fuentes, sinComentarios } from './_fuentes';
import { argumentosDeNivelUno, cierreDe } from './_literales';

/**
 * Los números y las fechas visibles salen en el idioma ACTIVO de la app, no en el
 * del navegador (que decide `toLocaleString()` sin argumentos) ni con punto
 * decimal fijo (`toFixed`). Pasaba: «80.0 Mbps» en español y «14/10/2026, 20:53:28»
 * con la app en inglés. La salida es única: `lib/format.ts` (`formatNumber`,
 * `formatFixed`, `formatDateTime`, `formatDate`, `formatTime`), que pasa
 * `intlLocale()`.
 *
 * Este gate recorre `src/` y falla nombrando el fichero y la línea ante:
 *  - `toLocaleString/DateString/TimeString(...)` cuyo primer argumento no sea
 *    `intlLocale()`;
 *  - `Intl.NumberFormat/DateTimeFormat/…(...)` igual;
 *  - `.toFixed(` fuera de la allowlist (siempre escribe punto decimal).
 * Tolera el formateo multilínea de Prettier (`d\n  .toLocaleTimeString(…)`).
 */

interface Hallazgo {
  linea: number;
  codigo: string;
}

const LOCALE_OK = 'intlLocale()';

function primerArgumentoNoEsElLocale(codigo: string, abre: number): boolean {
  const cierre = cierreDe(codigo, abre);
  if (cierre === -1) return true; // código ilegible: falla cerrado
  const args = argumentosDeNivelUno(codigo.slice(abre + 1, cierre));
  return args[0] !== LOCALE_OK;
}

function lineaDe(codigo: string, indice: number): number {
  return codigo.slice(0, indice).split('\n').length;
}

/** `toLocale*String(...)` e `Intl.*(...)` sin el locale de la app. */
export function sinLocaleActivo(codigo: string): Hallazgo[] {
  const salida: Hallazgo[] = [];
  const patrones = [
    /\.\s*toLocale(?:Date|Time)?String\s*\(/g,
    /\bIntl\s*\.\s*(?:NumberFormat|DateTimeFormat|RelativeTimeFormat|ListFormat|PluralRules|DisplayNames)\s*\(/g,
  ];
  for (const re of patrones) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(codigo)) !== null) {
      const abre = m.index + m[0].length - 1;
      if (primerArgumentoNoEsElLocale(codigo, abre)) {
        salida.push({ linea: lineaDe(codigo, m.index), codigo: m[0].trim() });
      }
    }
  }
  return salida;
}

/** Todas las llamadas a `.toFixed(`. */
export function usosDeToFixed(codigo: string): Hallazgo[] {
  const re = /\.\s*toFixed\s*\(/g;
  const salida: Hallazgo[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(codigo)) !== null) {
    salida.push({ linea: lineaDe(codigo, m.index), codigo: m[0].trim() });
  }
  return salida;
}

/**
 * `toFixed` permitido, por fichero y CON su porqué. Si el fichero deja de usarlo
 * la entrada queda obsoleta y el test falla: la allowlist no se pudre.
 */
const TOFIXED_PERMITIDO: Record<string, string> = {
  'components/ui/sparkline.tsx':
    'coordenadas de un `path` SVG: el atributo `d` exige punto decimal en cualquier idioma, no se lee como texto',
};

describe('formato por el idioma activo (gate sobre src/)', () => {
  const todas = fuentes();

  it('el barrido ve el árbol y los usos legítimos de lib/format.ts', () => {
    expect(todas.length).toBeGreaterThan(200);
    const format = todas.find((f) => f.nombre === 'lib/format.ts');
    // formatNumber (Intl.NumberFormat) + formatDateTime/Date/Time (toLocale*String).
    const conLocale = (format?.codigo.match(/intlLocale\(\)/g) ?? []).length;
    expect(conLocale).toBeGreaterThanOrEqual(4);
  });

  it('ningún toLocale*String ni Intl.* sin intlLocale()', () => {
    const fallos = todas.flatMap((f) =>
      sinLocaleActivo(f.codigo).map((h) => `${f.nombre}:${h.linea}  ${h.codigo}`),
    );
    expect(fallos, `usa lib/format.ts (formatNumber/formatDate/…):\n${fallos.join('\n')}`).toEqual(
      [],
    );
  });

  it('ningún toFixed fuera de la allowlist', () => {
    const fallos = todas
      .filter((f) => !(f.nombre in TOFIXED_PERMITIDO))
      .flatMap((f) => usosDeToFixed(f.codigo).map((h) => `${f.nombre}:${h.linea}`));
    expect(fallos, `usa formatFixed(n, dígitos) de lib/format.ts:\n${fallos.join('\n')}`).toEqual(
      [],
    );
  });

  it('la allowlist de toFixed no está obsoleta', () => {
    for (const nombre of Object.keys(TOFIXED_PERMITIDO)) {
      const f = todas.find((x) => x.nombre === nombre);
      expect(f, `${nombre} ya no existe: quítalo de la allowlist`).toBeDefined();
      expect(
        usosDeToFixed(f!.codigo).length,
        `${nombre} ya no usa toFixed: quítalo de la allowlist`,
      ).toBeGreaterThan(0);
    }
  });
});

describe('el detector (control positivo sintético)', () => {
  it('caza toLocale*String sin locale, también partido en líneas', () => {
    expect(sinLocaleActivo('const a = new Date(x).toLocaleString();')).toHaveLength(1);
    expect(sinLocaleActivo('d.toLocaleTimeString([], { hour: "2-digit" })')).toHaveLength(1);
    expect(
      sinLocaleActivo('d\n  .toLocaleDateString(\n    undefined,\n    { day: 1 },\n  )'),
    ).toHaveLength(1);
    expect(sinLocaleActivo("n.toLocaleString('es-ES')")).toHaveLength(1); // fijo ≠ activo
    expect(sinLocaleActivo('n.toLocaleString(navigator.language)')).toHaveLength(1);
  });

  it('caza Intl.* sin locale', () => {
    expect(sinLocaleActivo('new Intl.NumberFormat().format(1)')).toHaveLength(1);
    expect(sinLocaleActivo('new Intl.DateTimeFormat(undefined, {}).format(d)')).toHaveLength(1);
  });

  it('acepta el locale de la app', () => {
    expect(sinLocaleActivo('new Date(v).toLocaleString(intlLocale(), options)')).toEqual([]);
    expect(sinLocaleActivo('new Intl.NumberFormat(intlLocale(), options).format(n)')).toEqual([]);
  });

  it('un comentario que cita el patrón no delata al fichero', () => {
    const codigo = sinComentarios('// antes: d.toLocaleString()\n/* n.toFixed(1) */\nconst x = 1;');
    expect(sinLocaleActivo(codigo)).toEqual([]);
    expect(usosDeToFixed(codigo)).toEqual([]);
  });

  it('caza toFixed, también partido en líneas', () => {
    expect(usosDeToFixed('`${v.toFixed(1)} Mbps`')).toHaveLength(1);
    expect(usosDeToFixed('(a / b)\n  .toFixed(2)')).toHaveLength(1);
  });
});
