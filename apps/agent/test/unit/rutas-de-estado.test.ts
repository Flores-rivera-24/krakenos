import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Gate de las rutas de estado (US-280).
 *
 * Un servicio de Windows o un paquete instalado no arranca desde `apps/agent`, así que
 * ningún módulo puede suponerlo: cada `resolve('data/…')`, `resolve('var')` o
 * `process.cwd()` suelto es una ruta que `KRAKENOS_DATA_DIR`/`KRAKENOS_APP_DIR` no
 * mueve. Todo pasa por `config/paths.ts`. Como en `egress-coverage.test.ts`, el alcance
 * lo deriva el gate recorriendo `src/`, no una lista escrita a mano, y mira CÓDIGO (sin
 * comentarios) y tolera llamadas partidas en varias líneas.
 */

const SRC = fileURLToPath(new URL('../../src', import.meta.url));

/** Único fichero que puede nombrar el `cwd` y componer los directorios de estado. */
const PROPIETARIO = 'config/paths.ts';

/**
 * Excepciones con motivo. Una entrada que ya no tiene hallazgo hace fallar el test
 * (lista obsoleta). Hoy no hace falta ninguna.
 */
const ALLOWLIST = new Map<string, string>();

const DIRECTORIOS_DE_ESTADO = '(?:data|var|keys|certs|prisma)';

/** `process.cwd()` (con o sin espacios/saltos de línea alrededor del punto). */
const CWD = /process\s*\.\s*cwd\s*\(\s*\)/g;
/** `resolve`/`join` con un directorio de estado como literal, en cualquier argumento. */
const DIR_DE_ESTADO = new RegExp(
  `\\b(?:resolve|join)\\(\\s*(?:[^()]*?,\\s*)?['"\`](?:\\.{1,2}/)?${DIRECTORIOS_DE_ESTADO}(?:['"\`/]|\\$\\{)`,
  'g',
);
/**
 * Una constante de módulo con una ruta de estado dentro (`const X = 'data/extra-deps.json'`): se
 * resolvería contra el cwd o el repo y `KRAKENOS_DATA_DIR` no la movería. Solo asignaciones de
 * `const`/`let` (no nombres lógicos dentro de un objeto, como `KEY_ENTRY_NAMES`).
 */
const CONSTANTE_DE_RUTA = new RegExp(
  `\\b(?:const|let)\\s+\\w+\\s*(?::\\s*[\\w<>\\[\\]| ]+?)?=\\s*['"\`](?:\\.{1,2}/)?${DIRECTORIOS_DE_ESTADO}/[^'"\`]*['"\`]\\s*;`,
  'g',
);
/** `resolve('../…')`: subir desde el `cwd` (la web construida, la raíz del repo). */
const SUBIR_DESDE_CWD = /\b(?:resolve|join)\(\s*['"`]\.\.[/'"`]/g;

function sinComentarios(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
}

/** Descripción de cada hallazgo (`línea: texto`) en un fuente. */
export function hallazgosDeRutas(fuente: string): string[] {
  const limpio = sinComentarios(fuente);
  const out: string[] = [];
  for (const re of [CWD, DIR_DE_ESTADO, SUBIR_DESDE_CWD, CONSTANTE_DE_RUTA]) {
    for (const m of limpio.matchAll(re)) {
      const linea = limpio.slice(0, m.index).split('\n').length;
      out.push(`${linea}: ${m[0].replace(/\s+/g, ' ')}`);
    }
  }
  return out;
}

function ficherosTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...ficherosTs(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('rutas de estado: todo pasa por config/paths.ts (US-280)', () => {
  const ficheros = ficherosTs(SRC);

  it('recorre un árbol de tamaño creíble', () => {
    expect(ficheros.length).toBeGreaterThan(150);
  });

  it('ningún módulo fuera de config/paths.ts nombra el cwd ni compone data/var/keys/certs/prisma', () => {
    const infractores: string[] = [];
    const vistos = new Set<string>();
    for (const f of ficheros) {
      const rel = relative(SRC, f).split(sep).join('/');
      if (rel === PROPIETARIO) continue;
      const hallazgos = hallazgosDeRutas(readFileSync(f, 'utf8'));
      if (hallazgos.length === 0) continue;
      if (ALLOWLIST.has(rel)) {
        vistos.add(rel);
        continue;
      }
      infractores.push(...hallazgos.map((h) => `${rel}:${h}`));
    }
    expect(
      infractores,
      'Usa `agentPaths()` de config/paths.ts (KRAKENOS_DATA_DIR / KRAKENOS_APP_DIR)',
    ).toEqual([]);
    const obsoletas = [...ALLOWLIST.keys()].filter((k) => !vistos.has(k));
    expect(obsoletas, 'allowlist obsoleta: ya no hay hallazgo en estos ficheros').toEqual([]);
  });

  it('el propietario sí contiene lo que el gate prohíbe fuera (el gate mira de verdad)', () => {
    // Control positivo: si la regex dejara de casar, el test anterior pasaría en vacío.
    const propio = readFileSync(join(SRC, PROPIETARIO), 'utf8');
    expect(hallazgosDeRutas(propio).length).toBeGreaterThan(0);
  });

  describe('control positivo sintético', () => {
    it.each([
      ["resolve('var')", 1],
      ["resolve('var/restore-staging')", 1],
      ["resolve('data/cameras.json')", 1],
      ["join('./keys', 'a.pem')", 1],
      ["resolve('prisma', 'migrations')", 1],
      ['resolve(`var/pre-restore-${stamp}`)', 1],
      ["resolve('var', `backup-${id}.kbk`)", 1],
      ["join(agentDir, 'keys')", 1],
      ["resolve('../web/dist')", 1],
      ["resolve('../..')", 1],
      ["const EXTRA_DEPS_FILE = 'data/extra-deps.json';", 1],
      ["export const STORE: string = './var/hls';", 1],
      ['const d = process.cwd();', 1],
      ['const d = process\n  .cwd();', 1],
      ["resolve(\n  'data/vlans.json',\n)", 1],
    ])('detecta %j', (codigo, n) => {
      expect(hallazgosDeRutas(codigo).length).toBeGreaterThanOrEqual(n);
    });

    it.each([
      ["// resolve('var') en un comentario"],
      ['/* process.cwd() citado */ const a = 1;'],
      ["resolve(varDir, 'update.lock')"],
      ["join(dir, 'snapshot.db')"],
      ["name.startsWith('keys/')"],
      ["listDirEntries(this.keysDir, 'keys')"],
      ["const x = 'data'"],
      ["export const KEY_NAMES = { a: 'keys/jwt-private.pem' };"],
      ["const url = 'data/x'.length;"],
    ])('no marca %j', (codigo) => {
      expect(hallazgosDeRutas(codigo)).toEqual([]);
    });
  });
});
