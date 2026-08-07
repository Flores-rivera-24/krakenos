import type { FastifyInstance } from 'fastify';

import { eventually } from './app.js';

/**
 * Lectura del log de auditoría en tests, con espera.
 *
 * **El invariante:** `app.audit()` es *fire-and-forget* —`plugins/audit.ts` llama a
 * `persistAuditWithRetry` sin `await`— y ante un fallo transitorio de escritura
 * reintenta con backoff (100/500/2000 ms). Es decir: cuando la ruta responde, la
 * fila **todavía puede no estar**. Leer la tabla justo después de la respuesta es
 * una carrera que se gana casi siempre y se pierde bajo carga.
 *
 * No es teórico: el 2026-08-07 tumbó `main`. `dns-history.routes.test.ts` leía la
 * fila a pelo, en CI **con coverage** (345 s frente a 221 s en local) perdió la
 * carrera y falló con `expected null not to be null`; el mismo run relanzado sin
 * tocar nada salió verde. El coste real no es el rojo: es que **el fallo no se
 * parece a su causa** —parece un bug de la ruta que acabas de tocar—, así que se
 * paga buscándolo en el diff equivocado.
 *
 * Por eso la espera vive **aquí y no en cada test**: 24 de los 25 sitios ya la
 * hacían a mano con `eventually`, y el que se la saltó no rompió ninguna regla
 * escrita — no había ninguna. Con un punto único, olvidarla deja de ser posible y
 * el gate `auditoria-en-tests.test.ts` lo comprueba.
 */

/** Fila del log de auditoría (`AuditLog` de `schema.prisma`). */
export interface FilaAuditoria {
  id: string;
  action: string;
  userId: string | null;
  detail: string | null;
  ip: string | null;
  createdAt: Date;
}

/** Filtro por los campos que asiertan los tests; se pasa tal cual como `where`. */
export interface FiltroAuditoria {
  action?: string;
  userId?: string | null;
  detail?: string | null;
  ip?: string | null;
}

/**
 * Espera a que la auditoría haya escrito **al menos** `minimo` filas que casen con
 * `filtro` y las devuelve (más antigua primero). Si no llegan dentro del timeout de
 * `eventually`, lanza diciendo qué se esperaba y qué había — un timeout mudo aquí
 * volvería a costar la sesión de depuración que este helper existe para evitar.
 *
 * Devuelve las filas en vez de un booleano para que el test asierte **sus campos**
 * (`userId`, `detail`): que exista una fila no prueba que diga lo que debe decir.
 */
export async function esperarAuditoria(
  app: FastifyInstance,
  filtro: FiltroAuditoria,
  opciones: { minimo?: number } = {},
): Promise<FilaAuditoria[]> {
  const minimo = opciones.minimo ?? 1;
  return eventually(async () => {
    const filas = await app.prisma.auditLog.findMany({
      where: filtro,
      orderBy: { createdAt: 'asc' },
    });
    if (filas.length < minimo) {
      throw new Error(
        `Auditoría: se esperaban ≥${minimo} filas de ${JSON.stringify(filtro)}, hay ${filas.length}`,
      );
    }
    return filas;
  });
}

/** Igual que `esperarAuditoria`, para el caso corriente de una sola fila. */
export async function esperarUnaAuditoria(
  app: FastifyInstance,
  filtro: FiltroAuditoria,
): Promise<FilaAuditoria> {
  const [fila] = await esperarAuditoria(app, filtro);
  if (!fila) throw new Error('inalcanzable: `esperarAuditoria` garantiza al menos una fila');
  return fila;
}
