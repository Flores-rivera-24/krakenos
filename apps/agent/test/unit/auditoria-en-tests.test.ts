import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Gate: la tabla de auditoría no se lee a pelo en los tests.
 *
 * `app.audit()` es *fire-and-forget* y reintenta con backoff, así que cuando la
 * ruta responde la fila **todavía puede no estar**. La convención de esperar
 * existía y se seguía en **24 de 25** sitios… a mano, con un `eventually` escrito
 * en cada uno. El sitio 25 (`dns-history.routes.test.ts`) se la saltó, y el
 * 2026-08-07 tumbó `main`: falló solo en CI **con coverage**, y el mismo run
 * relanzado sin tocar nada salió verde.
 *
 * La lección no es «acordarse», es que una convención que hay que repetir en 25
 * sitios se incumple en uno — el mismo razonamiento que movió el guard de
 * controlabilidad a `CompositeIotManager` en vez de copiarlo por backend. La
 * espera vive ahora en `helpers/audit.ts` y este gate impide volver a saltársela:
 * recorre `test/`, y si alguien lee `auditLog` directamente fuera de la allowlist,
 * falla nombrando fichero y línea.
 *
 * Qué NO hace: no prueba que la espera funcione (eso lo hacen los tests que la
 * usan). Solo garantiza que no hay una segunda puerta.
 */

const RAIZ = fileURLToPath(new URL('..', import.meta.url));

/** Lectura de la tabla de auditoría: es la que corre la carrera. */
const LECTURA_DIRECTA = /prisma\.auditLog\.(findFirst|findMany|count)\s*\(/g;

/**
 * Quién puede leerla directamente, y por qué. Si esta lista crece, el motivo se
 * escribe aquí — no se añade y ya, que es como una allowlist deja de proteger.
 */
const PERMITIDOS = new Map([
  ['helpers/audit.ts', 'es el propio helper: alguien tiene que leer la tabla'],
  [
    'integration/retention.test.ts',
    'siembra sus filas con `create` y comprueba qué dejó la poda: no hay `app.audit()` de por medio, así que no hay carrera que esperar',
  ],
]);

/**
 * Quita comentarios para no marcar un `auditLog.findFirst` citado en prosa. Se
 * sustituyen por espacios (no se borran) para conservar los offsets y poder seguir
 * calculando el número de línea real. Duplicado a propósito respecto al gate del
 * egress: dos gates que comparten utilidades se rompen a la vez.
 */
function sinComentarios(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
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

describe('gate: la auditoría se lee con espera, no a pelo', () => {
  const ficheros = ficherosTs(RAIZ);

  it('recorre un árbol de tamaño creíble', () => {
    // Guard obligatorio de todo meta-test que recolecta: si la recolección se
    // rompe, la lista sale vacía y el test pasa en verde sin comprobar nada.
    expect(ficheros.length).toBeGreaterThan(200);
  });

  it('el helper lo usa mucha gente: si esto baja, la migración se ha revertido', () => {
    // El otro lado del guard. Sin él, borrar el helper y volver a leer a pelo
    // dejaría este fichero en verde mientras el gate de abajo no encuentra nada
    // que marcar… porque ya no habría nada que recolectar bien.
    const usuarios = ficheros.filter((f) => readFileSync(f, 'utf8').includes('helpers/audit.js'));
    expect(usuarios.length).toBeGreaterThan(15);
  });

  it('nadie lee `auditLog` fuera del helper', () => {
    const infractores: string[] = [];

    for (const file of ficheros) {
      const rel = relative(RAIZ, file).split('\\').join('/');
      if (PERMITIDOS.has(rel)) continue;

      const src = sinComentarios(readFileSync(file, 'utf8'));
      for (const m of src.matchAll(LECTURA_DIRECTA)) {
        // Línea real a partir del offset: el hallazgo tiene que ser accionable.
        const linea = src.slice(0, m.index).split('\n').length;
        infractores.push(`${rel}:${linea}`);
      }
    }

    // El fallo dice fichero y línea para que el arreglo sea cambiar la lectura
    // por `esperarAuditoria`/`esperarUnaAuditoria` y no una cacería.
    expect(infractores).toEqual([]);
  });

  it('la allowlist sigue siendo la de los dos casos justificados', () => {
    // Sin esto, «arreglar» un fallo futuro metiendo el fichero en la allowlist
    // pasaría desapercibido: el test de arriba volvería a verde solo.
    expect([...PERMITIDOS.keys()].sort()).toEqual([
      'helpers/audit.ts',
      'integration/retention.test.ts',
    ]);
  });
});
