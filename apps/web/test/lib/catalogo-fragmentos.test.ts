import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { es } from '@/lib/i18n/catalog/es';
import { esCore } from '@/lib/i18n/catalog/es-core';
import { esRegistrado } from '@/lib/i18n/registro';
import { SRC } from './_fuentes';
import {
  analizarFuente,
  cierreEstatico,
  type Analisis,
  clavesNombradas,
  modulos,
  raicesPerezosas,
  type Modulo,
} from './_modulos';

/**
 * Gate: el catálogo español NO viaja entero en el arranque; cada pantalla trae el
 * suyo.
 *
 * ## Por qué existe
 *
 * `catalog/es.ts` es la fuente del copy **y** el fallback síncrono de `t()`, así
 * que vivía en el bundle de entrada: 33 kB gzip de los 143 de la carga inicial, y
 * crecía con cada historia con interfaz hasta que la siguiente ya no cabía en el
 * presupuesto. Ahora el arranque solo lleva el núcleo (`es-core.ts`) y el resto se
 * reparte en fragmentos (`catalog/fragments/*.ts`) que se REGISTRAN al evaluarse su
 * módulo. Un módulo no se evalúa hasta que lo han hecho sus dependencias estáticas,
 * así que el fragmento está antes del primer render de quien lo importa y `t()`
 * sigue siendo síncrono, sin estados de «cargando copy».
 *
 * ## Qué ata
 *
 *  1. Quien NOMBRA una clave de un fragmento importa ese fragmento. Si no, en
 *     español sale la clave cruda (`settings.title`) en vez del texto, y solo si ese
 *     fichero se carga sin que nadie más haya registrado el fragmento: un fallo que
 *     los tests de componentes no ven porque comparten módulos entre sí.
 *  2. El arranque no carga ningún fragmento ni el catálogo recompuesto. Si lo hace,
 *     el copy vuelve al bundle inicial y el presupuesto se come el margen.
 *  3. El núcleo y los fragmentos reparten TODAS las claves sin pisarse (el spread de
 *     `es.ts` pisaría una clave duplicada sin avisar).
 *  4. El núcleo no engorda con copy de una sola pantalla: es justo el fallo que
 *     este reparto vino a arreglar.
 *
 * ## Alcance honesto
 *
 * Ve claves literales y prefijos de plantilla (`rooms.icon.${x}`). No ve una clave
 * construida por concatenación ni un `import(variable)`: esos huecos los cubre el
 * test de componentes (renderizan y asertan el texto) y la revisión.
 */

// ---- piezas del reparto ----
const fragmentosPorModulo = import.meta.glob('@/lib/i18n/catalog/fragments/*.ts', {
  eager: true,
}) as Record<string, Record<string, unknown>>;

interface Fragmento {
  nombre: string;
  ruta: string;
  claves: string[];
}

const DIR_FRAGMENTOS = join(SRC, 'lib/i18n/catalog/fragments');

function fragmentos(): Fragmento[] {
  return Object.entries(fragmentosPorModulo).map(([id, mod]) => {
    const nombre = id.replace(/^.*\//, '').replace(/\.ts$/, '');
    const datos = Object.values(mod).find((v) => typeof v === 'object' && v !== null) as
      | Record<string, string>
      | undefined;
    return { nombre, ruta: join(DIR_FRAGMENTOS, `${nombre}.ts`), claves: Object.keys(datos ?? {}) };
  });
}

/** Cabeza de la que cuelgan los módulos de catálogo: no son «código que usa copy». */
const DIR_I18N = join(SRC, 'lib/i18n') + sep;
const ES_COMPUESTO = join(SRC, 'lib/i18n/catalog/es.ts');

/** Prefijos transversales: casi toda pantalla los pinta, y por eso viven en el núcleo. */
const PREFIJOS_TRANSVERSALES: Record<string, string> = {
  common: 'botones y palabras que repite cualquier pantalla',
  ui: 'estados de carga y de conexión compartidos',
  errors: 'los mensajes de error los pinta `describeError`, que usan todas las pantallas',
  day: 'días de la semana: horarios, rutinas y tarjetas de varias pantallas',
  sun: 'amanecer y atardecer: horarios y rutinas',
  glossary: 'el glosario lo enlazan siete pantallas',
};

// ---- lógica pura del gate (se prueba con casos sintéticos más abajo) ----

/**
 * Fragmentos cuyo import falta en una fuente: los de las claves que nombra y que
 * ella no importa. `importados` son los ficheros que importa de valor.
 */
function fragmentosQueFaltan(
  analisis: Analisis,
  importados: ReadonlySet<string>,
  claveAFragmento: ReadonlyMap<string, Fragmento>,
): { fragmento: Fragmento; clave: string }[] {
  const nombradas = clavesNombradas(analisis, [...claveAFragmento.keys()]);
  const faltan = new Map<string, { fragmento: Fragmento; clave: string }>();
  for (const clave of nombradas) {
    const fragmento = claveAFragmento.get(clave)!;
    if (!importados.has(fragmento.ruta) && !faltan.has(fragmento.nombre)) {
      faltan.set(fragmento.nombre, { fragmento, clave });
    }
  }
  return [...faltan.values()];
}

const todos = fragmentos();
const claveAFragmento = new Map<string, Fragmento>();
for (const f of todos) for (const c of f.claves) claveAFragmento.set(c, f);

/** Los módulos de la app que SÍ pintan copy (fuera del propio catálogo y su registro). */
function modulosDeApp(): Modulo[] {
  return [...modulos().values()].filter((m) => !m.ruta.startsWith(DIR_I18N));
}

describe('catálogo en fragmentos', () => {
  describe('guards: el gate mira de verdad', () => {
    it('hay fragmentos, claves y ficheros suficientes', () => {
      // Si la recolección se rompe, las listas salen vacías y todo lo demás pasaría.
      expect(todos.length).toBeGreaterThanOrEqual(20);
      expect(Object.keys(es).length).toBeGreaterThan(2000);
      expect(Object.keys(esCore).length).toBeGreaterThan(100);
      expect(modulosDeApp().length).toBeGreaterThan(150);
      expect(raicesPerezosas(modulos()).size).toBeGreaterThanOrEqual(20);
    });

    it('la mayoría del copy vive en fragmentos, no en el núcleo', () => {
      // El núcleo medido al partir era el 6 % de las claves. Un umbral holgado
      // pero real: si el 40 % del copy volviera al núcleo, el arranque habría
      // recuperado el problema sin que ninguna regla individual saltara.
      expect(Object.keys(esCore).length / Object.keys(es).length).toBeLessThan(0.4);
    });

    it('el análisis ve ficheros que usan fragmentos (control positivo real)', () => {
      const claves = [...claveAFragmento.keys()];
      const usuarios = modulosDeApp().filter((m) => clavesNombradas(m.analisis, claves).size > 0);
      expect(usuarios.length).toBeGreaterThan(60);
    });
  });

  describe('control positivo sintético de fragmentosQueFaltan', () => {
    const f: Fragmento = { nombre: 'x', ruta: '/src/x.ts', claves: ['x.titulo', 'x.item.a'] };
    const mapa = new Map<string, Fragmento>([
      ['x.titulo', f],
      ['x.item.a', f],
    ]);

    it('caza una clave literal sin el import del fragmento', () => {
      const r = fragmentosQueFaltan(analizarFuente(`t('x.titulo')`), new Set(), mapa);
      expect(r.map((x) => x.clave)).toEqual(['x.titulo']);
    });

    it('caza el prefijo de una plantilla', () => {
      const r = fragmentosQueFaltan(analizarFuente('t(`x.item.${n}`)'), new Set(), mapa);
      expect(r).toHaveLength(1);
    });

    it('caza una clave guardada en un mapa que otro fichero pinta', () => {
      const r = fragmentosQueFaltan(
        analizarFuente(`const M = { a: 'x.item.a' };`),
        new Set(),
        mapa,
      );
      expect(r).toHaveLength(1);
    });

    it('no acusa si el fragmento está importado', () => {
      expect(
        fragmentosQueFaltan(analizarFuente(`t('x.titulo')`), new Set(['/src/x.ts']), mapa),
      ).toEqual([]);
    });

    it('no acusa una clave que solo aparece en un comentario', () => {
      const codigo = `// t('x.titulo') se pinta en otra parte\n/* x.item.a */\nconst a = 1;`;
      expect(fragmentosQueFaltan(analizarFuente(codigo), new Set(), mapa)).toEqual([]);
    });

    it('no acusa una clave del núcleo (no está en el mapa de fragmentos)', () => {
      expect(fragmentosQueFaltan(analizarFuente(`t('nav.settings')`), new Set(), mapa)).toEqual([]);
    });

    it('un import solo de tipos NO registra el fragmento', () => {
      const a = analizarFuente(`import type { A } from './x';\nimport { b } from './y';`);
      expect(a.estaticos).toEqual(['./y']);
    });
  });

  describe('1. quien nombra una clave de un fragmento lo importa', () => {
    it('ningún fichero pinta una clave de fragmento sin importarlo', () => {
      const incumplidos: string[] = [];
      for (const m of modulosDeApp()) {
        for (const { fragmento, clave } of fragmentosQueFaltan(
          m.analisis,
          new Set(m.estaticos),
          claveAFragmento,
        )) {
          incumplidos.push(
            `${m.ruta.slice(SRC.length + 1).replaceAll('\\', '/')} nombra \`${clave}\` (fragmento «${fragmento.nombre}») sin ` +
              `importarlo: añade \`import '@/lib/i18n/catalog/fragments/${fragmento.nombre}';\``,
          );
        }
      }
      expect(
        incumplidos,
        'El copy de una pantalla viaja en su fragmento, que solo se registra si el ' +
          'módulo que lo pinta lo importa. Sin el import, en español sale la clave cruda ' +
          'siempre que nadie más haya cargado ese fragmento.\n' +
          incumplidos.join('\n'),
      ).toEqual([]);
    });
  });

  describe('2. el arranque no trae copy de pantalla', () => {
    const entrada = join(SRC, 'main.tsx');
    const cierre = cierreEstatico(modulos(), entrada);

    it('el cierre estático del arranque es el que se espera (guard)', () => {
      expect(cierre.size).toBeGreaterThan(25);
      expect(cierre.has(join(SRC, 'App.tsx'))).toBe(true);
      expect(cierre.has(join(SRC, 'lib/i18n/index.ts'))).toBe(true);
      // Las páginas son perezosas: si aparecen, el grafo está mal leído.
      expect(cierre.has(join(SRC, 'pages/SettingsPage.tsx'))).toBe(false);
    });

    it('ningún fragmento cae en el cierre estático del arranque', () => {
      const dentro = todos.filter((f) => cierre.has(f.ruta)).map((f) => f.nombre);
      expect(
        dentro,
        'Estos fragmentos viajarían en la carga inicial. Algo del arranque (layout, ' +
          'nav, splash…) nombra una clave que no es del núcleo: muévela a `es-core.ts` ' +
          'o saca su uso del arranque.',
      ).toEqual([]);
    });

    it('el arranque no importa el catálogo recompuesto (traería todos los fragmentos)', () => {
      expect(cierre.has(ES_COMPUESTO)).toBe(false);
    });

    it('ningún módulo de la app importa el catálogo recompuesto como valor', () => {
      // Solo `import type` (se borra al compilar) y los tests pueden: importarlo en
      // código de la app arrastra los ~25 fragmentos al chunk que lo haga.
      const culpables = modulosDeApp()
        .filter((m) => m.estaticos.includes(ES_COMPUESTO))
        .map((m) => m.ruta.slice(SRC.length + 1));
      expect(
        culpables,
        'Importa `@/lib/i18n/registro` (esRegistrado) para consultar el catálogo en ' +
          'uso, o `import type` si solo necesitas el tipo.',
      ).toEqual([]);
    });
  });

  describe('3. el reparto es completo y sin solapes', () => {
    it('cada clave está en el núcleo o en UN fragmento', () => {
      const vistas = new Map<string, string>();
      const repetidas: string[] = [];
      const partes: [string, string[]][] = [
        ['es-core', Object.keys(esCore)],
        ...todos.map((f): [string, string[]] => [f.nombre, f.claves]),
      ];
      for (const [donde, claves] of partes) {
        for (const c of claves) {
          const antes = vistas.get(c);
          if (antes) repetidas.push(`${c}: ${antes} y ${donde}`);
          vistas.set(c, donde);
        }
      }
      expect(repetidas, 'El spread de es.ts pisaría la duplicada sin avisar').toEqual([]);
      expect(vistas.size).toBe(Object.keys(es).length);
    });

    it('registrar un fragmento deja sus claves en el catálogo en uso', () => {
      // Los fragmentos se importan en este fichero (glob eager), así que ya están.
      for (const f of todos) {
        for (const c of f.claves.slice(0, 3)) expect(esRegistrado[c]).toBeDefined();
      }
      expect(Object.keys(esRegistrado).length).toBe(Object.keys(es).length);
    });
  });

  describe('4. el núcleo no engorda con copy de una sola pantalla', () => {
    const entrada = cierreEstatico(modulos(), join(SRC, 'main.tsx'));
    const mapa = modulos();
    const raices = [...raicesPerezosas(mapa)];
    const cierres = raices.map((r) => cierreEstatico(mapa, r));
    const nucleo = Object.keys(esCore);
    const aplicacion = modulosDeApp();

    /** Raíces perezosas desde las que algún fichero nombra la clave. */
    function raicesDe(clave: string): number {
      const usuarios = aplicacion
        .filter((m) => clavesNombradas(m.analisis, [clave]).size > 0)
        .map((m) => m.ruta);
      let n = 0;
      for (const cierre of cierres) if (usuarios.some((u) => cierre.has(u))) n++;
      return n;
    }

    it('los prefijos transversales declarados siguen existiendo en el núcleo (sin lista obsoleta)', () => {
      for (const p of Object.keys(PREFIJOS_TRANSVERSALES)) {
        expect(
          nucleo.some((k) => k.startsWith(`${p}.`)),
          `«${p}» ya no tiene claves en el núcleo: quítalo de PREFIJOS_TRANSVERSALES`,
        ).toBe(true);
      }
    });

    it('toda clave del núcleo la usa el arranque, es transversal o la usan varias pantallas', () => {
      const sobran: string[] = [];
      for (const clave of nucleo) {
        const prefijo = clave.split('.')[0]!;
        if (prefijo in PREFIJOS_TRANSVERSALES) continue;
        const delArranque = [...entrada].some((f) => {
          const m = mapa.get(f);
          // El propio catálogo (`es-core.ts`) nombra todas sus claves: no cuenta como uso.
          return (
            m !== undefined &&
            !f.startsWith(DIR_I18N) &&
            clavesNombradas(m.analisis, [clave]).size > 0
          );
        });
        if (delArranque) continue;
        if (raicesDe(clave) === 1) sobran.push(clave);
      }
      expect(
        sobran,
        'Estas claves del núcleo (`es-core.ts`) solo las usa UNA pantalla: viajan en la ' +
          'carga inicial de todas. Muévelas al fragmento de su pantalla ' +
          '(`catalog/fragments/<pantalla>.ts`, y en `en.ts` no cambia nada).\n' +
          sobran.join('\n'),
      ).toEqual([]);
    });
  });
});
