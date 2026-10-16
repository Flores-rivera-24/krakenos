import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALERT_EVENTS, AUDIT_ACTIONS } from '@krakenos/types';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Gate de las acciones de auditoría.
 *
 * La tabla de auditoría del dashboard («Alertas recientes») y la de Ajustes enseñaban
 * `auth.login` crudo: el agente no tiene i18n y la web no tenía un texto por acción.
 * La salida es el patrón de `ALERT_EVENTS`: una lista cerrada en `@krakenos/types`
 * (`AUDIT_ACTIONS`) y, en la web, un `Record<AuditAction, TranslationKey>` exhaustivo.
 *
 * **Dos candados, y este fichero es el segundo.** El primero es el tipo: `app.audit`
 * recibe `AuditAction`, así que una acción fuera de la lista no compila. Pero el tipo
 * solo ve una dirección, y un `as` lo salta. Este test recorre `src/` **por AST** (no
 * por expresión regular: `audit({ action: … })` se parte en varias líneas y la acción
 * puede ser un ternario) y ata las dos direcciones:
 *   1. toda acción que el agente audita está en la lista;
 *   2. toda acción de la lista se audita en algún sitio (una lista obsoleta es un
 *      texto traducido para algo que ya no ocurre, y una fila de más en cada idioma).
 */

const SRC = fileURLToPath(new URL('../../src', import.meta.url));

/**
 * Las acciones que NO son un literal en la llamada. Dos casos y solo dos; cualquier otra
 * expresión hace fallar el test (un `as AuditAction` o una acción compuesta con una
 * plantilla escaparían a la lista sin que nadie lo viera).
 *
 *  - `aviso.accion` (alarma): el tipo es la unión `'alarm.smoke' | 'alarm.co'` de
 *    `alarm/life-safety.ts`.
 *  - el ternario de las solicitudes de acceso se resuelve solo (ambas ramas literales),
 *    así que no figura aquí.
 *
 * La clave es `fichero::expresión`; si el sitio desaparece, la entrada queda obsoleta y
 * el test falla.
 */
const DINAMICAS_DECLARADAS: Record<string, string[]> = {
  'modules/alarm/alarm.service.ts::aviso.accion': ['alarm.smoke', 'alarm.co'],
};

interface Hallazgo {
  acciones: string[];
  /** Acciones que no son literales ni ternario de literales: `expresión`. */
  dinamicas: string[];
  /** Llamadas a `audit(` cuyo argumento no es un objeto con `action`. */
  malas: string[];
  llamadas: number;
}

/** Resuelve un literal de cadena o un ternario cuyas ramas lo son; `null` si no. */
function resolver(node: ts.Expression): string[] | null {
  if (ts.isStringLiteralLike(node)) return [node.text];
  if (ts.isParenthesizedExpression(node)) return resolver(node.expression);
  if (ts.isConditionalExpression(node)) {
    const a = resolver(node.whenTrue);
    const b = resolver(node.whenFalse);
    return a && b ? [...a, ...b] : null;
  }
  return null;
}

/** Escanea una fuente. Exportado en el propio test para poder probarlo con un control positivo. */
function escanear(fuente: string, nombre: string): Hallazgo {
  const sf = ts.createSourceFile(nombre, fuente, ts.ScriptTarget.Latest, true);
  const h: Hallazgo = { acciones: [], dinamicas: [], malas: [], llamadas: 0 };
  const visitar = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      const nombreLlamada = ts.isPropertyAccessExpression(callee)
        ? callee.name.text
        : ts.isIdentifier(callee)
          ? callee.text
          : '';
      // Exactamente `audit`: `pushNotificationForAudit(action)` y similares no son altas.
      if (nombreLlamada === 'audit' && n.arguments[0]) {
        h.llamadas += 1;
        const arg = n.arguments[0];
        const prop = ts.isObjectLiteralExpression(arg)
          ? arg.properties.find((p) => p.name?.getText(sf) === 'action')
          : undefined;
        if (!prop || !ts.isPropertyAssignment(prop)) {
          h.malas.push(arg.getText(sf).slice(0, 60));
        } else {
          const valores = resolver(prop.initializer);
          if (valores) h.acciones.push(...valores);
          else h.dinamicas.push(prop.initializer.getText(sf));
        }
      }
    }
    ts.forEachChild(n, visitar);
  };
  visitar(sf);
  return h;
}

function ficherosTs(dir: string): string[] {
  const out: string[] = [];
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) out.push(...ficherosTs(ruta));
    else if (ruta.endsWith('.ts')) out.push(ruta);
  }
  return out;
}

const porFichero = new Map<string, Hallazgo>();
for (const f of ficherosTs(SRC)) {
  const h = escanear(readFileSync(f, 'utf8'), f);
  if (h.llamadas > 0) porFichero.set(relative(SRC, f).replaceAll('\\', '/'), h);
}

const usadas = new Set<string>();
const dinamicasVistas = new Set<string>();
let llamadas = 0;
for (const [fichero, h] of porFichero) {
  llamadas += h.llamadas;
  for (const a of h.acciones) usadas.add(a);
  for (const expr of h.dinamicas) {
    const clave = `${fichero}::${expr}`;
    dinamicasVistas.add(clave);
    for (const a of DINAMICAS_DECLARADAS[clave] ?? []) usadas.add(a);
  }
}

describe('acciones de auditoría', () => {
  it('guard de tamaño: el escaneo ve las llamadas (si se rompe, la lista saldría vacía)', () => {
    // Medido al escribirlo: 155 llamadas a `audit(` y 128 acciones literales distintas.
    expect(llamadas).toBeGreaterThan(100);
    expect(usadas.size).toBeGreaterThan(100);
    expect(AUDIT_ACTIONS.length).toBeGreaterThan(100);
  });

  it('toda acción que el agente audita está en AUDIT_ACTIONS', () => {
    const lista = new Set<string>(AUDIT_ACTIONS);
    const fuera = [...usadas].filter((a) => !lista.has(a)).sort();
    expect(fuera, `acciones auditadas que faltan en AUDIT_ACTIONS: ${fuera.join(', ')}`).toEqual(
      [],
    );
  });

  it('toda acción de AUDIT_ACTIONS se audita en algún sitio (lista obsoleta = rojo)', () => {
    const obsoletas = AUDIT_ACTIONS.filter((a) => !usadas.has(a)).sort();
    expect(obsoletas, `en la lista y nunca auditadas: ${obsoletas.join(', ')}`).toEqual([]);
  });

  it('la lista no repite acciones', () => {
    expect(new Set(AUDIT_ACTIONS).size).toBe(AUDIT_ACTIONS.length);
  });

  it('solo hay dos formas de acción no literal y están declaradas (y vigentes)', () => {
    const sinDeclarar = [...dinamicasVistas].filter((c) => !(c in DINAMICAS_DECLARADAS));
    expect(sinDeclarar, 'acciones con expresión no resoluble').toEqual([]);
    const obsoletas = Object.keys(DINAMICAS_DECLARADAS).filter((c) => !dinamicasVistas.has(c));
    expect(obsoletas, 'entradas de DINAMICAS_DECLARADAS que ya no existen').toEqual([]);
    for (const miembros of Object.values(DINAMICAS_DECLARADAS)) {
      for (const m of miembros) expect(AUDIT_ACTIONS as readonly string[]).toContain(m);
    }
  });

  it('ninguna llamada a audit() pasa algo que no sea un objeto con `action`', () => {
    const malas = [...porFichero].flatMap(([f, h]) => h.malas.map((m) => `${f}: ${m}`));
    expect(malas).toEqual([]);
  });

  it('toda alerta configurable es una acción de auditoría (la regla se dispara con la fila)', () => {
    const lista = new Set<string>(AUDIT_ACTIONS);
    expect(ALERT_EVENTS.filter((e) => !lista.has(e))).toEqual([]);
  });

  // Control positivo SINTÉTICO: el escaneo tiene que seguir viendo lo que debe, o el
  // resto del fichero pasaría en vacío.
  it('control positivo: el escaneo ve literales, multilínea y ternarios, y marca lo irresoluble', () => {
    const h = escanear(
      `
      app.audit({ action: 'a.uno', detail: 'x' });
      app.audit({
        userId: u,
        action:
          decision === 'approve' ? 'b.si' : 'b.no',
      });
      app.audit({ action: cual });
      app.audit({ action: \`c.\${x}\` });
      app.audit(opciones);
      pushNotificationForAudit('no.cuenta');
      `,
      'sintetico.ts',
    );
    expect(h.llamadas).toBe(5);
    expect(h.acciones.sort()).toEqual(['a.uno', 'b.no', 'b.si']);
    expect(h.dinamicas.sort()).toEqual(['`c.${x}`', 'cual']);
    expect(h.malas).toEqual(['opciones']);
  });
});
