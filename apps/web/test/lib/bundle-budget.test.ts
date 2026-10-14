import { describe, expect, it } from 'vitest';
// El checker es puro y vive junto al CLI que corre en CI (US-193).
import {
  checkBudget,
  checkRoutes,
  initialChunkNames,
  pageNames,
  routeWeights,
  staticClosure,
} from '../../scripts/bundle-budget.mjs';

const BUDGET = { maxInitialKb: 130, maxChunkKb: 120, maxRouteKb: 300 };
const INICIAL = ['index-BFOKBPkT.js'];

/** Chunks realistas del build actual (calibración 2026-07-09). */
const OK_CHUNKS = [
  { name: 'index-BFOKBPkT.js', gzipKb: 85.1 },
  { name: 'index-DjTPlhVC.js', gzipKb: 21.8 },
  { name: 'AreaChart-FIaJQFqi.js', gzipKb: 101.4 },
  { name: 'SettingsPage-BL0gWoX0.js', gzipKb: 12.3 },
];

/** Presupuesto de rendimiento móvil (US-193): bloquea regresiones simuladas. */
describe('bundle-budget (US-193)', () => {
  it('el build actual queda dentro de presupuesto', () => {
    expect(checkBudget(OK_CHUNKS, BUDGET, INICIAL)).toEqual([]);
  });

  it('una entrada engordada (regresión simulada) viola el presupuesto', () => {
    const fat = [...OK_CHUNKS, { name: 'index-nuevo.js', gzipKb: 50 }];
    const violations = checkBudget(fat, BUDGET, ['index-BFOKBPkT.js', 'index-nuevo.js']); // 135.1
    expect(violations.some((v) => v.includes('carga inicial'))).toBe(true);
  });

  it('un chunk gigante nuevo (dep pesada sin split) viola el presupuesto', () => {
    const violations = checkBudget(
      [...OK_CHUNKS, { name: 'MapaGordo-abc.js', gzipKb: 130 }],
      BUDGET,
      INICIAL,
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('MapaGordo');
  });

  it('el total emitido ya NO es un gate: partir en trozos perezosos no penaliza', () => {
    const lazy = Array.from({ length: 60 }, (_, i) => ({ name: `Pagina${i}-x.js`, gzipKb: 15 }));
    expect(checkBudget([...OK_CHUNKS, ...lazy], BUDGET, INICIAL)).toEqual([]); // ~1 MB emitido
  });

  it('sin index.html (initialNames) falla cerrado', () => {
    expect(checkBudget(OK_CHUNKS, BUDGET)).toHaveLength(1);
  });

  describe('carga inicial real (entrada + modulepreload)', () => {
    const HTML = `<!doctype html><html><head>
      <script src="/theme-init.js"></script>
      <script type="module" crossorigin src="/assets/index-AAA.js"></script>
      <link rel="modulepreload" crossorigin href="/assets/react-dom-BBB.js">
      <link rel="stylesheet" crossorigin href="/assets/index-CCC.css">
      <link rel="modulepreload" href="/assets/i18n-DDD.js">
    </head><body></body></html>`;

    it('extrae el módulo de entrada y los modulepreload, y nada más', () => {
      expect(initialChunkNames(HTML)).toEqual(['index-AAA.js', 'react-dom-BBB.js', 'i18n-DDD.js']);
    });

    it('sin preloads solo cuenta la entrada (la suma cambia)', () => {
      expect(
        initialChunkNames('<script type="module" src="/assets/index-AAA.js"></script>'),
      ).toEqual(['index-AAA.js']);
    });

    const CHUNKS = [
      { name: 'index-AAA.js', gzipKb: 16 },
      { name: 'react-dom-BBB.js', gzipKb: 41 },
      { name: 'i18n-DDD.js', gzipKb: 39 },
      { name: 'Lazy-EEE.js', gzipKb: 50 },
    ];

    it('la entrada pequeña con preloads gordos viola el presupuesto (el hueco que dejaba rolldown)', () => {
      const names = initialChunkNames(HTML);
      expect(checkBudget(CHUNKS, { ...BUDGET, maxInitialKb: 90 }, ['index-AAA.js'])).toEqual([]); // solo la entrada: ciego
      const v = checkBudget(CHUNKS, { ...BUDGET, maxInitialKb: 90 }, names);
      expect(v).toHaveLength(1);
      expect(v[0]).toContain('96.0 kB');
      expect(v[0]).toContain('react-dom-BBB.js');
    });

    it('falla cerrado si index.html carga un chunk que no existe en dist', () => {
      const v = checkBudget(CHUNKS, BUDGET, ['index-AAA.js', 'fantasma-ZZZ.js']);
      expect(v.some((x) => x.includes('fantasma-ZZZ.js'))).toBe(true);
    });

    it('falla cerrado si index.html no carga ningún index-*', () => {
      const v = checkBudget(CHUNKS, BUDGET, ['react-dom-BBB.js']);
      expect(v.some((x) => x.includes('index-*'))).toBe(true);
    });
  });

  describe('peso por ruta (manifest)', () => {
    // inicial = index (16) + react (41) = 57. `shared` lo comparten dos páginas;
    // `deep` cuelga de `shared` (import anidado).
    const MANIFEST = {
      'index.html': { file: 'assets/index-A.js', imports: ['_react'] },
      _react: { file: 'assets/react-B.js' },
      _shared: { file: 'assets/shared-C.js', imports: ['_deep', 'index.html', '_react'] },
      _deep: { file: 'assets/deep-D.js' },
      _sock: { file: 'assets/sock-E.js', imports: ['_react'] },
      'src/lib/socket-client.ts': { file: 'assets/sockcli-F.js', imports: ['_sock'] },
      'src/pages/APage.tsx': { file: 'assets/APage-G.js', imports: ['_shared', 'index.html'] },
      'src/pages/BPage.tsx': { file: 'assets/BPage-H.js', imports: ['_react'] },
      'src/pages/LoginPage.tsx': { file: 'assets/LoginPage-I.js', imports: ['_react'] },
    };
    const SIZES = [
      { name: 'index-A.js', gzipKb: 16 },
      { name: 'react-B.js', gzipKb: 41 },
      { name: 'shared-C.js', gzipKb: 10 },
      { name: 'deep-D.js', gzipKb: 5 },
      { name: 'sock-E.js', gzipKb: 3 },
      { name: 'sockcli-F.js', gzipKb: 8 },
      { name: 'APage-G.js', gzipKb: 20 },
      { name: 'BPage-H.js', gzipKb: 7 },
      { name: 'LoginPage-I.js', gzipKb: 2 },
    ];
    const base = {
      manifest: MANIFEST,
      chunks: SIZES,
      initialNames: ['index-A.js', 'react-B.js'],
      publicPages: ['LoginPage'],
      extras: ['src/lib/socket-client.ts'],
    };
    const by = (w: ReturnType<typeof routeWeights>, r: string) => w.find((x) => x.route === r);

    it('extrae las páginas lazy de App.tsx, sin repetir', () => {
      const src = `const A = lazy(() => import('@/pages/APage').then(m => m))
        const B = lazy(() =>
          import("@/pages/BPage").then(m => m))
        const again = import('@/pages/APage'); import('@/lib/otra')`;
      expect(pageNames(src)).toEqual(['APage', 'BPage']);
    });

    it('lo que ya está en la carga inicial no cuenta dos veces', () => {
      const w = routeWeights({ ...base, pages: ['APage', 'BPage', 'LoginPage'] });
      // APage: ella 20 + shared 10 + deep 5 + extras (sockcli 8 + sock 3) = 46; index y react NO.
      expect(by(w, 'APage')?.ownKb).toBe(46);
      expect(by(w, 'APage')?.totalKb).toBe(57 + 46);
      // BPage solo trae su chunk (+ extras): react ya viaja en la inicial.
      expect(by(w, 'BPage')?.ownKb).toBe(7 + 8 + 3);
    });

    it('sigue imports anidados y no repite un chunk alcanzable por dos caminos', () => {
      expect(staticClosure(MANIFEST, 'src/pages/APage.tsx').sort()).toEqual(
        ['APage-G.js', 'deep-D.js', 'index-A.js', 'react-B.js', 'shared-C.js'].sort(),
      );
    });

    it('las páginas públicas no cargan los extras de después del login', () => {
      const w = routeWeights({ ...base, pages: ['LoginPage'] });
      expect(by(w, 'LoginPage')?.ownKb).toBe(2);
    });

    it('falla cerrado si una ruta declarada no está en el manifest', () => {
      expect(() => routeWeights({ ...base, pages: ['APage', 'FantasmaPage'] })).toThrow(
        /FantasmaPage/,
      );
    });

    it('falla cerrado si un extra o un chunk no existe', () => {
      expect(() => routeWeights({ ...base, pages: ['APage'], extras: ['src/nada.ts'] })).toThrow(
        /src\/nada\.ts/,
      );
      expect(() => routeWeights({ ...base, chunks: SIZES.slice(0, 6), pages: ['APage'] })).toThrow(
        /APage-G\.js/,
      );
    });

    it('la peor ruta por encima de maxRouteKb viola el presupuesto y la nombra', () => {
      const w = routeWeights({ ...base, pages: ['APage', 'BPage'] });
      const v = checkRoutes(w, { maxRouteKb: 100 }, { expectedPages: 2, minPages: 2 });
      expect(v).toHaveLength(1);
      expect(v[0]).toContain('APage');
      expect(checkRoutes(w, { maxRouteKb: 103 }, { expectedPages: 2, minPages: 2 })).toEqual([]);
    });

    it('guard de tamaño: menos rutas de las esperadas no pasa en verde', () => {
      const w = routeWeights({ ...base, pages: ['APage', 'BPage'] });
      expect(checkRoutes(w, { maxRouteKb: 999 }, { expectedPages: 3, minPages: 2 })).toHaveLength(
        1,
      );
      expect(checkRoutes([], { maxRouteKb: 999 }, { expectedPages: 0 })).toHaveLength(1);
      expect(checkRoutes(w, { maxRouteKb: 999 }, { expectedPages: 2 })).toHaveLength(1); // < 15
    });
  });
});
