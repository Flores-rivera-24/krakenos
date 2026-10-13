import { describe, expect, it } from 'vitest';
// El checker es puro y vive junto al CLI que corre en CI (US-193).
import { checkBudget, initialChunkNames } from '../../scripts/bundle-budget.mjs';

const BUDGET = { maxEntryKb: 130, maxChunkKb: 120, maxTotalKb: 400 };

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
    expect(checkBudget(OK_CHUNKS, BUDGET)).toEqual([]);
  });

  it('una entrada engordada (regresión simulada) viola el presupuesto', () => {
    const fat = [...OK_CHUNKS, { name: 'index-nuevo.js', gzipKb: 40 }]; // entrada: 146.9 kB
    const violations = checkBudget(fat, BUDGET);
    expect(violations.some((v) => v.includes('carga inicial'))).toBe(true);
  });

  it('un chunk gigante nuevo (dep pesada sin split) viola el presupuesto', () => {
    const violations = checkBudget(
      [...OK_CHUNKS, { name: 'MapaGordo-abc.js', gzipKb: 130 }],
      BUDGET,
    );
    expect(violations).toHaveLength(1); // solo el chunk (el total, ~351 kB, sigue dentro)
    expect(violations[0]).toContain('MapaGordo');
  });

  it('el crecimiento global también se acota (total)', () => {
    const bloated = Array.from({ length: 30 }, (_, i) => ({
      name: `Pagina${i}-x.js`,
      gzipKb: 15,
    }));
    const violations = checkBudget([...OK_CHUNKS, ...bloated], BUDGET); // ~670 kB
    expect(violations.some((v) => v.includes('total'))).toBe(true);
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
      expect(checkBudget(CHUNKS, { ...BUDGET, maxEntryKb: 90 })).toEqual([]); // sin preloads: ciego
      const v = checkBudget(CHUNKS, { ...BUDGET, maxEntryKb: 90 }, names);
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
});
