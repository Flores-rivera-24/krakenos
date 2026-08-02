import type { HomeEvent, Id, LifeSafetyMetric } from '@krakenos/types';
import { isLifeSafetyMetric } from '@krakenos/types';

/**
 * Aviso de riesgo vital (US-245): humo y CO avisan **siempre**, esté la alarma
 * armada o no y esté el detector en su lista de vigilancia o no.
 *
 * Este módulo es **puro**: decide *si* hay que avisar y *de qué*. Los efectos
 * (auditoría → push/email/Telegram, log, sirena) los pone `AlarmService`.
 *
 * El agujero que cierra: hasta aquí un detector de humo tenía que cruzar **dos**
 * puertas para que pasara algo —estar en `alarm.config.sensorDeviceIds` y que la
 * alarma estuviese armada—, y las dos son de un sistema **antirrobo**. Un
 * detector recién emparejado que ve humo a las 4 de la mañana con la alarma
 * desarmada no producía absolutamente nada: ni aviso, ni registro, ni traza. El
 * usuario habría jurado que su detector estaba conectado a la app, porque en
 * `/iot` se veía.
 */

/**
 * Ventana de rearme por aparato y métrica. Un detector que oscila (`1 → 0 → 1`,
 * típico mientras el humo se disipa) no debe convertirse en cuarenta avisos: el
 * primero ya cumple su función y los siguientes solo enseñan a ignorarlos.
 *
 * No es un `cooldown` de la alarma: el estado sigue publicándose en el bus y en
 * la UI durante la ventana; lo único que se espacia es el **aviso**.
 */
export const REARME_AVISO_VITAL_MS = 5 * 60_000;

/** Acción de auditoría que dispara el aviso multicanal, por métrica. */
const ACCION_POR_METRICA: Record<LifeSafetyMetric, 'alarm.smoke' | 'alarm.co'> = {
  smoke: 'alarm.smoke',
  co: 'alarm.co',
};

export interface AvisoVital {
  /** Clave de rearme: un detector combinado avisa de humo y de CO por separado. */
  clave: string;
  deviceId: Id;
  metric: LifeSafetyMetric;
  /** Acción auditada; es también la clave del catálogo de alertas (US-112). */
  accion: 'alarm.smoke' | 'alarm.co';
}

/** Clave de rearme de un aparato y una métrica. */
export function claveDeAviso(deviceId: Id, metric: LifeSafetyMetric): string {
  return `${deviceId}::${metric}`;
}

/**
 * ¿Este evento del bus obliga a avisar? Devuelve el aviso o `null`.
 *
 * Condiciones, todas necesarias:
 * - es una lectura de humo o CO (la **métrica** manda, nunca el número — US-244);
 * - es un **flanco de subida** (de reposo a activo), no la repetición de un valor
 *   que ya estaba alto: si no, cada barrido volvería a avisar de lo mismo;
 * - no se avisó de lo mismo dentro de la ventana de rearme.
 *
 * ⚠️ `prevValue === null` **sí** avisa: significa que la métrica aparece ahora
 * (detector que se acaba de conectar y ya reporta humo). Ante la duda entre un
 * aviso de más y un incendio en silencio, avisa.
 */
export function decideAvisoVital(
  event: HomeEvent,
  ultimosAvisos: ReadonlyMap<string, number>,
  now: number,
  ventanaMs: number = REARME_AVISO_VITAL_MS,
): AvisoVital | null {
  if (event.type !== 'sensor-reading') return null;
  if (!isLifeSafetyMetric(event.metric)) return null;
  const activo = event.value >= 1;
  const estabaActivo = event.prevValue !== null && event.prevValue >= 1;
  if (!activo || estabaActivo) return null;

  const clave = claveDeAviso(event.deviceId, event.metric);
  const ultimo = ultimosAvisos.get(clave);
  if (ultimo !== undefined && now - ultimo < ventanaMs) return null;

  return { clave, deviceId: event.deviceId, metric: event.metric, accion: ACCION_POR_METRICA[event.metric] };
}

/** Texto del aviso: «Humo detectado en Cocina» / «Monóxido de carbono detectado en Garaje». */
export function detalleDeAviso(metric: LifeSafetyMetric, nombreDelAparato: string): string {
  const que = metric === 'smoke' ? 'Humo detectado' : 'Monóxido de carbono detectado';
  return `${que} en ${nombreDelAparato}`;
}
