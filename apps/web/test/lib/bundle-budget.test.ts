import { describe, expect, it } from 'vitest';
// El checker es puro y vive junto al CLI que corre en CI (US-193).
import { checkBudget } from '../../scripts/bundle-budget.mjs';

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
    expect(violations.some((v) => v.includes('entrada'))).toBe(true);
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
});
