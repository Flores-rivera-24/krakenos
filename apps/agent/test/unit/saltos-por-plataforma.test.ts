import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Gate de los saltos por plataforma (US-281, Fase 11).
 *
 * La suite corre también en `windows-latest` (job no bloqueante de `ci.yml`). Lo que NO
 * aplica en Windows se salta con `skipIf(process.platform === 'win32')` y un MOTIVO. Sin
 * contarlos, cada salto es una excepción silenciosa: la suite parece portable porque
 * deja de mirar justo donde duele.
 *
 * Este test recorre `test/` y compara, fichero a fichero, los saltos que HAY con los de
 * la lista cerrada de abajo. Falla en las dos direcciones:
 *  - aparece un salto nuevo (o un fichero nuevo que salta) → hay que añadirlo AQUÍ, con
 *    su porqué, o mejor aún, arreglar el test para que corra en Windows;
 *  - un fichero de la lista ya no salta (o salta menos) → la lista quedó obsoleta.
 *
 * Lo que NO se salta, se arregla: separadores de ruta en asserts (`resolve()`), borrar
 * una base abierta (cerrar antes), puertos. Un salto es para lo que de verdad no existe
 * en Windows: bits de modo POSIX, `chmod`/`umask`/grupos, el instalador de Debian.
 *
 * `soloPosix` cuenta las ASERCIONES que se envuelven en `if (process.platform !== 'win32')`
 * dentro de un test que sí corre (p. ej. el modo 0600 de un fichero, junto a lo demás
 * que el test comprueba y que sí vale en Windows). No son saltos del test, pero también
 * son cobertura que Windows no da, y se cuentan igual.
 *
 * Valor medido al crear el gate (2026-10-24, ver `TOTAL_MEDIDO`): saltos y aserciones
 * solo-POSIX, escritos en el último test.
 */

interface Entrada {
  saltos: number;
  soloPosix?: number;
  motivo: string;
}

const MODOS = 'Los bits de modo POSIX no existen en Windows (stat devuelve 666)';

const LISTA: Record<string, Entrada> = {
  'integration/cierre-con-sigint.test.ts': {
    saltos: 1,
    motivo:
      'Envía SIGINT al agente real: Windows no tiene señales POSIX (su cierre limpio es SIGBREAK, con test propio).',
  },
  'unit/migrate.test.ts': {
    saltos: 2,
    motivo: `${MODOS}: la copia previa debe ser 0600 y el directorio 0700.`,
  },
  'unit/backup-claves.test.ts': {
    saltos: 0,
    soloPosix: 1,
    motivo: `${MODOS}: el modo 0600 de la clave restaurada (los bytes sí se comprueban).`,
  },
  'unit/backup-stream.test.ts': {
    saltos: 1,
    motivo: `${MODOS}: el archivo de copia nace 0600.`,
  },
  'unit/helper-script.test.ts': {
    saltos: 1,
    motivo:
      'El helper de sudoers es un script de Linux: el argumento con tabulador no llega igual por el bash de Windows.',
  },
  'unit/install-script.test.ts': {
    saltos: 3,
    motivo:
      'install.sh es el instalador de Debian/Ubuntu (apt, systemd, sudo, root): los tres bloques del fichero, no solo lo que hoy falla.',
  },
  'unit/json-store.test.ts': {
    saltos: 2,
    motivo: `${MODOS}; y chmod 000 no quita el permiso de lectura, así que no se puede provocar el error de E/S.`,
  },
  'unit/keys.test.ts': {
    saltos: 2,
    soloPosix: 3,
    motivo: `${MODOS}; y no hay umask. El resto de cada test (par RS256, rotación, temporales) sí corre. El fallo de escritura se provoca con chmod 500 sobre el directorio.`,
  },
  'unit/local-ca-bundle.test.ts': {
    saltos: 0,
    soloPosix: 1,
    motivo: `${MODOS}: el modo 0600 de la clave de la CA (la CA y el servidor sí se validan).`,
  },
  'unit/local-ca.test.ts': {
    saltos: 3,
    motivo: `${MODOS}; y los grupos (id -gn, chmod) y el umask no existen.`,
  },
  'unit/peer-store.test.ts': {
    saltos: 2,
    motivo: `${MODOS}: el fichero de peers queda 0600.`,
  },
  'unit/secret-permissions.test.ts': {
    saltos: 1,
    motivo: `${MODOS}: no hay fichero «demasiado abierto» que avisar.`,
  },
  'unit/secretbox.test.ts': {
    saltos: 0,
    soloPosix: 1,
    motivo: `${MODOS}: el modo 0600 de la clave (el cifrado y su reutilización sí se comprueban).`,
  },
  'unit/secure-fs.test.ts': {
    saltos: 1,
    motivo: `${MODOS}; y no hay umask.`,
  },
};

/** Valor medido al crear el gate; si cambia la lista, cambia esto a propósito. */
const TOTAL_MEDIDO = { ficherosConSalto: 11, saltos: 19, soloPosix: 6 };

/** Saltos: `skipIf(… process.platform === 'win32' …)`, también `it.skipIf` y `describe.skipIf`. */
const SALTO = /skipIf\((?:[^()]|\([^()]*\))*?process\.platform\s*===\s*['"]win32['"]/g;
/** Aserciones solo-POSIX dentro de un test que sí corre. */
const SOLO_POSIX = /\bif\s*\(\s*process\.platform\s*!==\s*['"]win32['"]\s*\)/g;

function contar(texto: string): { saltos: number; soloPosix: number } {
  return {
    saltos: texto.match(SALTO)?.length ?? 0,
    soloPosix: texto.match(SOLO_POSIX)?.length ?? 0,
  };
}

const TEST_DIR = fileURLToPath(new URL('..', import.meta.url));

function ficheros(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? ficheros(join(dir, e.name))
      : e.name.endsWith('.test.ts')
        ? [join(dir, e.name)]
        : [],
  );
}

describe('saltos por plataforma (US-281)', () => {
  it('los detectores reconocen las formas (control positivo)', () => {
    expect(contar("it.skipIf(process.platform === 'win32')('x', () => {})").saltos).toBe(1);
    expect(contar("describe.skipIf(process.platform === 'win32')('x', () => {})").saltos).toBe(1);
    expect(contar("it.skipIf(isRoot || process.platform === 'win32')('x', () => {})").saltos).toBe(
      1,
    );
    expect(contar("it.skipIf(\n  process.platform === 'win32',\n)('x', () => {})").saltos).toBe(1);
    expect(contar("if (process.platform !== 'win32') expect(1).toBe(1)").soloPosix).toBe(1);
    // Lo que NO es un salto: un valor que depende de la plataforma, o skipIf de otra cosa.
    expect(contar("expect(x).toBe(process.platform === 'win32' ? 1 : 2)").saltos).toBe(0);
    expect(contar("it.skipIf(isRoot)('x', () => {})").saltos).toBe(0);
  });

  const reales = (() => {
    const todos = ficheros(TEST_DIR);
    const mapa: Record<string, { saltos: number; soloPosix: number }> = {};
    for (const f of todos) {
      // Este fichero cita las formas en sus muestras sintéticas: no cuenta.
      if (f === fileURLToPath(import.meta.url)) continue;
      const c = contar(readFileSync(f, 'utf8'));
      if (c.saltos > 0 || c.soloPosix > 0) {
        mapa[relative(TEST_DIR, f).replaceAll('\\', '/')] = c;
      }
    }
    return { total: todos.length, mapa };
  })();

  it('guard: la recolección recorre la suite entera', () => {
    expect(reales.total).toBeGreaterThan(250);
  });

  it('los saltos que hay son exactamente los de la lista cerrada, con su motivo', () => {
    const esperado = Object.fromEntries(
      Object.entries(LISTA).map(([f, e]) => [f, { saltos: e.saltos, soloPosix: e.soloPosix ?? 0 }]),
    );
    // Si falla: un salto nuevo se añade a LISTA con su porqué (o se arregla el test);
    // un fichero de la lista que ya no salta se quita de LISTA.
    expect(reales.mapa).toEqual(esperado);
  });

  it('cada entrada de la lista lleva un motivo', () => {
    for (const [f, e] of Object.entries(LISTA)) {
      expect(e.motivo.length, f).toBeGreaterThan(20);
    }
  });

  it('el total coincide con el valor medido', () => {
    const entradas = Object.values(LISTA);
    expect({
      ficherosConSalto: entradas.filter((e) => e.saltos > 0).length,
      saltos: entradas.reduce((n, e) => n + e.saltos, 0),
      soloPosix: entradas.reduce((n, e) => n + (e.soloPosix ?? 0), 0),
    }).toEqual(TOTAL_MEDIDO);
  });
});
