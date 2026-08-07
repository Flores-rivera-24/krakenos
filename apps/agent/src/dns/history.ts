import type { DnsQuery } from '@krakenos/types';

/**
 * Núcleo **puro** del histórico DNS (US-252): decidir qué consultas de las que
 * devuelve el resolver son nuevas, y a qué aparato pertenece cada una.
 *
 * Se separa del servicio porque es donde están los dos errores caros —duplicar
 * el histórico y atribuirlo al aparato equivocado— y ninguno de los dos falla
 * ruidosamente: uno infla los números y el otro acusa a otra persona.
 */

/**
 * Marca de agua de la ingesta. No basta con «el timestamp más alto visto»: dos
 * consultas del mismo milisegundo (un `A` y un `AAAA` del mismo aparato) tienen
 * el mismo instante, así que con solo el número se pierde una o se duplican las
 * dos en el siguiente barrido. Se guarda además la firma de las que ya se
 * ingirieron **en ese milisegundo**.
 */
export interface MarcaDeIngesta {
  /** Instante (ms epoch) de la consulta más reciente ya ingerida; `null` al arrancar. */
  ultimoMs: number | null;
  /** Firmas de las consultas ya ingeridas cuyo instante es exactamente `ultimoMs`. */
  firmasDelUltimoMs: string[];
}

/** Marca vacía: todo lo que llegue es nuevo. */
export const MARCA_INICIAL: MarcaDeIngesta = { ultimoMs: null, firmasDelUltimoMs: [] };

/**
 * Identifica una consulta dentro de su milisegundo. Dos consultas idénticas en el
 * mismo instante son indistinguibles con lo que publica el resolver, así que la
 * segunda se descarta: perder una repetición aparente es preferible a duplicar el
 * histórico, que es el error que sí se nota (y que no se puede deshacer leyendo).
 */
export function firmaDeConsulta(q: DnsQuery): string {
  return `${q.client}|${q.domain}|${q.blocked ? 1 : 0}`;
}

/** Resultado de seleccionar lo nuevo: qué ingerir y con qué marca continuar. */
export interface SeleccionDeIngesta {
  nuevas: DnsQuery[];
  marca: MarcaDeIngesta;
}

/**
 * Selecciona las consultas aún no ingeridas y calcula la marca siguiente.
 *
 * `consultas` llega en el orden que dé el resolver (Pi-hole las devuelve de más
 * reciente a más antigua); se ordena aquí y **no** se asume nada del llamante.
 * `tope` acota cuántas entran de una vez: sin él, un resolver que lleva días
 * acumulando mete su log entero en una transacción.
 */
export function seleccionarNuevas(
  consultas: DnsQuery[],
  marca: MarcaDeIngesta,
  tope: number,
): SeleccionDeIngesta {
  const conInstante = consultas
    .map((q) => ({ q, ms: Date.parse(q.timestamp) }))
    .filter((x) => Number.isFinite(x.ms))
    .sort((a, b) => a.ms - b.ms);

  const yaVistas = new Set(marca.firmasDelUltimoMs);
  const nuevas: DnsQuery[] = [];
  for (const { q, ms } of conInstante) {
    if (marca.ultimoMs !== null) {
      if (ms < marca.ultimoMs) continue;
      if (ms === marca.ultimoMs && yaVistas.has(firmaDeConsulta(q))) continue;
    }
    nuevas.push(q);
    if (nuevas.length >= tope) break;
  }

  if (nuevas.length === 0) return { nuevas, marca };

  // La marca avanza al instante de la última **ingerida**, no al máximo que se vio:
  // con el tope alcanzado, lo que no entró tiene que seguir siendo nuevo.
  const ultimoMs = Date.parse(nuevas[nuevas.length - 1]!.timestamp);
  const firmasDelUltimoMs = nuevas
    .filter((q) => Date.parse(q.timestamp) === ultimoMs)
    .map(firmaDeConsulta);
  // Si el corte cae dentro de un milisegundo ya visto, sus firmas viejas siguen
  // valiendo: se acumulan en vez de reemplazarse.
  if (marca.ultimoMs === ultimoMs) firmasDelUltimoMs.push(...marca.firmasDelUltimoMs);

  return { nuevas, marca: { ultimoMs, firmasDelUltimoMs: [...new Set(firmasDelUltimoMs)] } };
}

/**
 * Resuelve la IP del cliente al aparato del inventario. Devuelve `null` cuando no
 * consta: un histórico que inventa a quién pertenece una consulta es peor que uno
 * que admite no saberlo, porque lo segundo se ve y lo primero no.
 *
 * La comparación es exacta sobre la IP. No se intenta adivinar por rango ni por
 * nombre: son las dos vías por las que se acaba atribuyendo tráfico al vecino de
 * subred.
 */
export function macDelCliente(client: string, macPorIp: ReadonlyMap<string, string>): string | null {
  return macPorIp.get(client.trim()) ?? null;
}

/**
 * Cuántos aparatos **en línea** no han aparecido ni una vez en el histórico.
 *
 * Es la respuesta medible a «¿y los que usan DoH?»: un aparato que resuelve por
 * su cuenta no pasa por el resolver del hogar y por tanto no deja ni una fila. No
 * se afirma que use DoH —también puede llevar horas sin actividad—: se cuenta y
 * se explican las dos causas, que es lo que se puede sostener.
 */
export function aparatosSinConsultas(
  macsEnLinea: readonly string[],
  macsConConsultas: ReadonlySet<string>,
): number {
  return macsEnLinea.filter((mac) => !macsConConsultas.has(mac)).length;
}
