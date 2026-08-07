/**
 * Reafirmación periódica del bloqueo (US-255) — decisión **pura**.
 *
 * **El fallo que cierra:** el barrido de acceso solo llamaba al driver cuando el
 * estado *deseado* cambiaba (`if (shouldBlock === managedByUs) continue`). Como el
 * estado se guarda en KrakenOS y las reglas viven en el **router**, cualquier cosa
 * que borre las reglas ajenas a nosotros —un reinicio del router, un
 * `fw4 restart`, una restauración de config— deja el aparato navegando y a
 * KrakenOS convencido de que sigue cortado. No hay error, no hay log, no hay nada:
 * el panel dice «Bloqueado» y el crío está viendo vídeos.
 *
 * **Por qué con intervalo y no en cada barrido:** el barrido corre cada minuto y
 * cada bloqueo es un ida y vuelta por SSH. Con 20 aparatos cortados serían 20
 * comandos por minuto para siempre, contra un router doméstico. Se reafirma cada
 * `intervaloMs` por MAC.
 *
 * **Por qué con tope por barrido:** si no, las 20 vencen a la vez —todas se
 * afirmaron en el mismo arranque— y el barrido se convierte en una ráfaga. Con
 * tope se reparten solas en barridos siguientes, empezando por la más vieja.
 */

/** Cada cuánto se reafirma una MAC bloqueada. */
export const REAFIRMACION_INTERVALO_MS = 10 * 60_000;

/** Cuántas MACs se reafirman como mucho en un mismo barrido. */
export const REAFIRMACION_TOPE_POR_BARRIDO = 5;

export interface PlanDeReafirmacion {
  /** MACs a reafirmar ahora contra el driver, de la más vieja a la más reciente. */
  reafirmar: string[];
  /** MACs cuya marca sobra porque ya no deben estar bloqueadas (se olvidan). */
  olvidar: string[];
}

/**
 * Decide qué reafirmar en este instante.
 *
 * @param deseadas  MACs que **deben** estar bloqueadas ahora (manual ∪ horario ∪ pausa).
 * @param afirmadas Última reafirmación correcta por MAC, en ms.
 * @param ahoraMs   Instante del barrido.
 */
export function planDeReafirmacion(
  deseadas: Iterable<string>,
  afirmadas: ReadonlyMap<string, number>,
  ahoraMs: number,
  intervaloMs: number = REAFIRMACION_INTERVALO_MS,
  tope: number = REAFIRMACION_TOPE_POR_BARRIDO,
): PlanDeReafirmacion {
  const set = new Set(deseadas);

  // Una MAC que acaba de bloquearse no tiene marca: se le pone `-Infinity` para
  // que entre en la primera tanda. Es deliberado — el bloqueo que se acaba de
  // aplicar es justo el que menos evidencia tiene de haber llegado al router.
  const vencidas = [...set]
    .map((mac) => ({ mac, cuando: afirmadas.get(mac) ?? Number.NEGATIVE_INFINITY }))
    .filter((e) => ahoraMs - e.cuando >= intervaloMs)
    .sort((a, b) => a.cuando - b.cuando);

  // Las marcas de lo que ya no debe estar bloqueado se tiran: si no, una MAC que
  // se bloquea, se suelta y se vuelve a bloquear heredaría una marca vieja y se
  // quedaría sin reafirmar durante todo un intervalo.
  const olvidar = [...afirmadas.keys()].filter((mac) => !set.has(mac));

  return { reafirmar: vencidas.slice(0, tope).map((e) => e.mac), olvidar };
}
