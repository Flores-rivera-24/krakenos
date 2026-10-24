import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * **Los alias de shadcn (`bg-card`, `text-muted-foreground`, `bg-primary`…) apuntan a los tokens
 * `kr-*` en UN solo sitio** (`@theme inline` de `index.css`). Si volvieran a ser canales HSL
 * propios, 238 clases pintarían una paleta que `check-contrast.mjs` no mide.
 */
const CSS = readFileSync(join(__dirname, '../../src/index.css'), 'utf8');

const ESPERADO: Record<string, string> = {
  background: 'var(--kr-bg-base)',
  foreground: 'var(--kr-text-primary)',
  card: 'var(--kr-bg-surface)',
  'card-foreground': 'var(--kr-text-primary)',
  primary: 'var(--kr-accent)',
  'primary-foreground': '#ffffff',
  secondary: 'var(--kr-bg-elevated)',
  'secondary-foreground': 'var(--kr-text-primary)',
  muted: 'var(--kr-bg-elevated)',
  'muted-foreground': 'var(--kr-text-secondary)',
  destructive: 'var(--kr-danger-solid)',
  'destructive-foreground': '#ffffff',
  border: 'var(--kr-border)',
  input: 'var(--kr-border-field)',
  ring: 'var(--kr-ring)',
};

function valorDe(alias: string): string | undefined {
  const m = new RegExp(`^\\s*--color-${alias}:\\s*([^;]+);`, 'm').exec(CSS);
  return m?.[1]?.trim();
}

describe('alias de shadcn', () => {
  it.each(Object.entries(ESPERADO))('--color-%s → %s', (alias, esperado) => {
    expect(valorDe(alias)).toBe(esperado);
  });

  it('no queda ningún canal HSL de shadcn', () => {
    expect(CSS).not.toMatch(/hsl\(var\(--/);
    expect(CSS).not.toMatch(
      /^\s*--(background|foreground|card|primary|secondary|muted|destructive|border|input|ring)(-foreground)?:\s*[\d.]+ /m,
    );
  });
});
