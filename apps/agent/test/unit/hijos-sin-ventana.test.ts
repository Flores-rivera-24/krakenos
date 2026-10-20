import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Gate (US-280): toda llamada a `child_process` de `src/` lleva `windowsHide: true`.
 *
 * En Windows, un proceso hijo lanzado desde un servicio abre una ventana de consola
 * visible (un destello por cada `git`, `ffmpeg` o `sudo`). En Linux la opción no hace
 * nada, así que nadie la echa en falta hasta que alguien instala en Windows.
 *
 * El alcance lo deriva el gate: por cada fichero que importa de `node:child_process` toma
 * los nombres importados y los alias de `promisify(execFile)`, y exige la opción en los
 * argumentos de CADA llamada, también si están partidos en varias líneas. Mira código sin
 * comentarios.
 */

const SRC = fileURLToPath(new URL('../../src', import.meta.url));
const FUNCIONES = new Set([
  'spawn',
  'spawnSync',
  'execFile',
  'execFileSync',
  'exec',
  'execSync',
  'fork',
]);

function sinComentarios(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
}

/** Texto entre el paréntesis que abre en `desde` y su pareja, saltando cadenas. */
function argumentos(src: string, desde: number): string {
  let prof = 0;
  for (let i = desde; i < src.length; i++) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++;
      continue;
    }
    if (c === '(') prof++;
    else if (c === ')' && --prof === 0) return src.slice(desde, i + 1);
  }
  return src.slice(desde);
}

/** Llamadas a `child_process` de un fuente que NO llevan `windowsHide: true`. */
export function llamadasSinVentanaOculta(fuente: string): string[] {
  const src = sinComentarios(fuente);
  const nombres = new Set<string>();
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]node:child_process['"]/g)) {
    for (const parte of (m[1] ?? '').split(',')) {
      const [original, alias] = parte.trim().split(/\s+as\s+/);
      if (original && FUNCIONES.has(original)) nombres.add(alias ?? original);
    }
  }
  if (nombres.size === 0) return [];
  // `const execFileAsync = promisify(execFile)`: otro nombre para la misma función.
  for (const m of src.matchAll(/(?:const|let)\s+(\w+)\s*=\s*promisify\(\s*(\w+)\s*\)/g)) {
    if (m[1] && m[2] && nombres.has(m[2])) nombres.add(m[1]);
  }
  const malas: string[] = [];
  for (const nombre of nombres) {
    for (const m of src.matchAll(new RegExp(`(?<![\\w.$])${nombre}\\s*\\(`, 'g'))) {
      const abre = (m.index ?? 0) + m[0].length - 1;
      if (!/windowsHide\s*:\s*true/.test(argumentos(src, abre))) {
        malas.push(`línea ${src.slice(0, m.index).split('\n').length}: ${nombre}(…)`);
      }
    }
  }
  return malas;
}

function ficheros(dir: string): string[] {
  return readdirSync(dir).flatMap((e) => {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) return ficheros(full);
    return e.endsWith('.ts') ? [full] : [];
  });
}

describe('hijos sin ventana en Windows (US-280)', () => {
  const todos = ficheros(SRC);
  const usuarios = todos.filter((f) => /node:child_process/.test(readFileSync(f, 'utf8')));

  it('recorre un árbol de tamaño creíble y encuentra a los usuarios de child_process', () => {
    expect(todos.length).toBeGreaterThan(150);
    // Medido 2026-10-20: ffmpeg, secure-fs, privileged/runner, process-update-runner,
    // target-package y update-spawner.
    expect(usuarios.length).toBeGreaterThanOrEqual(6);
  });

  it('toda llamada lleva windowsHide: true', () => {
    const infractores = usuarios.flatMap((f) =>
      llamadasSinVentanaOculta(readFileSync(f, 'utf8')).map(
        (h) => `${relative(SRC, f).split(sep).join('/')}: ${h}`,
      ),
    );
    expect(infractores).toEqual([]);
  });

  describe('control positivo sintético', () => {
    const cabecera = "import { execFile, spawn } from 'node:child_process';\n";
    it('detecta una llamada sin la opción, también partida en varias líneas', () => {
      expect(
        llamadasSinVentanaOculta(`${cabecera}spawn('ls', [], { stdio: 'ignore' });`),
      ).toHaveLength(1);
      expect(
        llamadasSinVentanaOculta(
          `${cabecera}execFile(\n  'git',\n  ['x'],\n  { timeout: 5 },\n  cb,\n);`,
        ),
      ).toHaveLength(1);
    });

    it('detecta el alias de promisify(execFile)', () => {
      const src = `import { execFile } from 'node:child_process';\nconst run = promisify(execFile);\nawait run('git', ['x'], { timeout: 1 });`;
      expect(llamadasSinVentanaOculta(src)).toHaveLength(1);
    });

    it('acepta la opción y no se deja engañar por un comentario ni por otro objeto', () => {
      expect(
        llamadasSinVentanaOculta(
          `${cabecera}spawn('ls', [], { stdio: 'ignore', windowsHide: true });`,
        ),
      ).toEqual([]);
      expect(
        llamadasSinVentanaOculta(
          `${cabecera}execFile(\n  'git',\n  ['x'],\n  { windowsHide: true },\n  cb,\n);`,
        ),
      ).toEqual([]);
      // `windowsHide: true` citado en un comentario NO cuenta
      expect(
        llamadasSinVentanaOculta(`${cabecera}spawn('ls', []); // windowsHide: true`),
      ).toHaveLength(1);
      // y un método llamado igual no es la función importada
      expect(llamadasSinVentanaOculta(`${cabecera}foo.spawn('ls');`)).toEqual([]);
    });

    it('un fichero que no importa child_process no produce hallazgos', () => {
      expect(llamadasSinVentanaOculta("const spawn = () => 1; spawn('x');")).toEqual([]);
    });
  });
});
