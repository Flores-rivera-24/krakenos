import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * US-276 — dentro de un `$transaction(async (tx) => { … })` solo se usa `tx`.
 *
 * El adaptador de better-sqlite3 (Prisma 7) tiene UNA conexión y `db/serialized-adapter.ts`
 * la serializa: una consulta del cliente EXTERIOR (`app.prisma`, `this.prisma`…) lanzada
 * con la transacción abierta espera a que ésta acabe. Si el callback la `await`ea, la
 * transacción espera a la consulta y la consulta a la transacción: punto muerto hasta el
 * timeout de Prisma. Un comentario no vigila eso; este gate, sí.
 *
 * Reglas (por AST, sobre `apps/agent/src`):
 *  - Dentro del callback de todo `$transaction(async (<param>) => …)`, un `await` cuyo
 *    operando toque el cliente exterior (cualquier `x.prisma`, o un identificador `prisma`
 *    que no sea el parámetro) es una infracción.
 *  - También lo es `await app.audit(…)`: `audit` escribe con el cliente exterior.
 *  - Un `app.audit(…)` SIN `await` es aceptable: es fire-and-forget (se encola en el mutex
 *    y se ejecuta al acabar la transacción, sin bloquearla).
 *
 * Límite conocido de un gate estático: no ve una promesa del cliente exterior creada sin
 * `await` y esperada más tarde (`const p = prisma.x.find(); await p`). Cubrirlo exige un
 * control en runtime (ver el informe del PR).
 */

const SRC = resolve(import.meta.dirname, '../../src');

interface Infraccion {
  linea: number;
  texto: string;
}

interface Analisis {
  interactivas: number;
  infracciones: Infraccion[];
}

function esTransaccionInteractiva(
  node: ts.Node,
): node is ts.CallExpression & { arguments: [ts.ArrowFunction | ts.FunctionExpression] } {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== '$transaction') return false;
  const first = node.arguments[0];
  if (!first || !(ts.isArrowFunction(first) || ts.isFunctionExpression(first))) return false;
  return (first.modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);
}

/** ¿Este subárbol toca el cliente exterior (o espera a `app.audit`)? */
function tocaClienteExterior(root: ts.Node, param: string | null): boolean {
  let toca = false;
  const visit = (n: ts.Node): void => {
    if (toca) return;
    if (ts.isPropertyAccessExpression(n)) {
      // app.prisma · this.app.prisma · this.prisma · fastify.prisma …
      if (n.name.text === 'prisma') {
        toca = true;
        return;
      }
      // await app.audit(…): escribe con el cliente exterior.
      if (n.name.text === 'audit') {
        toca = true;
        return;
      }
    } else if (ts.isIdentifier(n) && n.text === 'prisma' && n.text !== param) {
      // `prisma.x…` con `prisma` un identificador suelto (no el parámetro de la tx).
      const padre = n.parent;
      const esNombreDePropiedad = ts.isPropertyAccessExpression(padre) && padre.name === n;
      if (!esNombreDePropiedad) {
        toca = true;
        return;
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(root);
  return toca;
}

function analizar(texto: string, nombre = 'x.ts'): Analisis {
  const sf = ts.createSourceFile(nombre, texto, ts.ScriptTarget.Latest, true);
  const out: Analisis = { interactivas: 0, infracciones: [] };

  const visit = (node: ts.Node): void => {
    if (esTransaccionInteractiva(node)) {
      out.interactivas++;
      const callback = node.arguments[0];
      const p = callback.parameters[0];
      const param = p && ts.isIdentifier(p.name) ? p.name.text : null;
      const enAwait = (n: ts.Node): void => {
        if (ts.isAwaitExpression(n) && tocaClienteExterior(n.expression, param)) {
          const { line } = sf.getLineAndCharacterOfPosition(n.getStart(sf));
          out.infracciones.push({ linea: line + 1, texto: n.getText(sf).slice(0, 80) });
        }
        ts.forEachChild(n, enAwait);
      };
      enAwait(callback.body);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

function fuentes(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'generated' ? [] : fuentes(p);
    return e.name.endsWith('.ts') ? [p] : [];
  });
}

describe('$transaction interactivo solo usa su `tx` (US-276)', () => {
  describe('el detector (control positivo sintético)', () => {
    it('caza un await al cliente exterior dentro del callback, en todas sus formas', () => {
      for (const llamada of [
        'await this.app.prisma.setting.findFirst()',
        'await app.prisma.setting.findFirst()',
        'await this.prisma.setting.findFirst()',
        'await prisma.setting.findFirst()',
        'await Promise.all([prisma.setting.findFirst()])',
        'await app.audit({ action: "x" })',
      ]) {
        const r = analizar(`
          class S { async f() {
            return this.app.prisma.$transaction(async (tx) => {
              await tx.user.findFirst();
              ${llamada};
            });
          } }`);
        expect(r.interactivas, llamada).toBe(1);
        expect(r.infracciones, llamada).toHaveLength(1);
      }
    });

    it('acepta tx, un audit sin await (fire-and-forget) y el cliente exterior FUERA del callback', () => {
      const r = analizar(`
        class S { async f() {
          const out = await this.app.prisma.$transaction(async (tx) => {
            const u = await tx.user.findFirst();
            await tx.setting.upsert({});
            this.app.audit({ action: 'x' }); // sin await: se encola, no bloquea
            return u;
          });
          await this.app.prisma.setting.findFirst(); // fuera del callback
          await this.app.audit({ action: 'y' });
          return out;
        } }`);
      expect(r.interactivas).toBe(1);
      expect(r.infracciones).toEqual([]);
    });

    it('un parámetro llamado `prisma` ES la transacción; la forma de lote no es interactiva', () => {
      const r = analizar(`
        async function f(prisma) {
          await prisma.$transaction(async (prisma) => { await prisma.user.findFirst(); });
          await prisma.$transaction([prisma.user.findFirst()]);
        }`);
      expect(r.interactivas).toBe(1);
      expect(r.infracciones).toEqual([]);
    });
  });

  it('ninguna transacción interactiva de src toca el cliente exterior con await', () => {
    const archivos = fuentes(SRC);
    expect(archivos.length).toBeGreaterThan(200); // guard: la recolección no se quedó vacía

    let interactivas = 0;
    const culpables: string[] = [];
    for (const f of archivos) {
      const texto = readFileSync(f, 'utf8');
      if (!texto.includes('$transaction')) continue;
      const r = analizar(texto, f);
      interactivas += r.interactivas;
      for (const i of r.infracciones) culpables.push(`${relative(SRC, f)}:${i.linea}  ${i.texto}`);
    }

    // Guard de tamaño: hoy son 4 (absorb, push, users ×2). Si la recolección se rompe,
    // la lista de culpables sale vacía y el test pasaría sin mirar nada.
    expect(interactivas).toBeGreaterThanOrEqual(4);
    expect(culpables).toEqual([]);
  });
});
