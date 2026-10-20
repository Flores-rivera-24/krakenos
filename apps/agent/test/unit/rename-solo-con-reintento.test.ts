import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Gate (US-280): ningún módulo de `src/` importa `rename`/`renameSync` de `node:fs`
 * salvo el propio helper (`system/rename-retry.ts`). Un `rename` a pelo es un `EPERM`
 * esperando a un antivirus de Windows. Mira código (sin comentarios) y tolera imports
 * partidos en varias líneas.
 */
const SRC = fileURLToPath(new URL('../../src', import.meta.url));
const PROPIETARIO = 'system/rename-retry.ts';
const IMPORT_FS = /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*['"]node:fs(?:\/promises)?['"]/g;
const MIEMBRO = /\b(?:fs|fsp|promises)\s*\.\s*rename(?:Sync)?\s*\(/;

function ficheros(dir: string): string[] {
  return readdirSync(dir).flatMap((e) => {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) return ficheros(full);
    return e.endsWith('.ts') ? [full] : [];
  });
}

function sinComentarios(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
}

function importaRename(fuente: string): boolean {
  const limpio = sinComentarios(fuente);
  for (const m of limpio.matchAll(IMPORT_FS)) {
    if (/\brename(?:Sync)?\b/.test(m[1] ?? '')) return true;
  }
  return MIEMBRO.test(limpio);
}

describe('rename solo con reintento (US-280)', () => {
  it('recorre un árbol de tamaño creíble', () => {
    expect(ficheros(SRC).length).toBeGreaterThan(150);
  });

  it('nadie fuera del helper usa el rename del sistema', () => {
    const infractores = ficheros(SRC)
      .map((f) => relative(SRC, f).split(sep).join('/'))
      .filter((rel) => rel !== PROPIETARIO)
      .filter((rel) => importaRename(readFileSync(join(SRC, rel), 'utf8')));
    expect(infractores).toEqual([]);
  });

  it('control positivo: el helper SÍ importa rename y el detector ve imports partidos', () => {
    expect(importaRename(readFileSync(join(SRC, PROPIETARIO), 'utf8'))).toBe(true);
    expect(importaRename("import {\n  mkdir,\n  rename,\n} from 'node:fs/promises';")).toBe(true);
    expect(importaRename("import { renameSync } from 'node:fs';")).toBe(true);
    expect(importaRename('await fs.rename(a, b)')).toBe(true);
    expect(importaRename("// import { rename } from 'node:fs';\nconst a = 1;")).toBe(false);
    expect(importaRename("import { renameWithRetry } from './rename-retry.js';")).toBe(false);
  });
});
