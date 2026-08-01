import type { IotMetric, IotReading } from '@krakenos/types';
import type { TranslationKey } from '@/lib/i18n';

/**
 * Presentación de las lecturas IoT (US-244) — **puro**, sin React.
 *
 * El problema que resuelve: desde que `metric` es una unión cerrada, las métricas
 * de seguridad valen `0` o `1`, y pintar «1» debajo de «Puerta de entrada» no le
 * dice nada a nadie. Una magnitud se enseña con su número y su unidad; un suceso
 * se enseña con una palabra.
 */

/** Clave de i18n con el nombre de cada métrica. Exhaustivo sobre `IotMetric`. */
export const METRIC_LABEL: Record<IotMetric, TranslationKey> = {
  temperature: 'iot.metric.temperature',
  humidity: 'iot.metric.humidity',
  power: 'iot.metric.power',
  energy: 'iot.metric.energy',
  battery: 'iot.metric.battery',
  illuminance: 'iot.metric.illuminance',
  contact: 'iot.metric.contact',
  occupancy: 'iot.metric.occupancy',
  smoke: 'iot.metric.smoke',
  co: 'iot.metric.co',
};

/**
 * Claves del estado activo/reposo de cada métrica de seguridad. Se nombran por lo
 * que significan para **ese** aparato: una puerta está «abierta», un detector de
 * humo no — traducir los dos como «activo» sería correcto y aun así inútil.
 */
const SECURITY_TEXT: Partial<Record<IotMetric, { on: TranslationKey; off: TranslationKey }>> = {
  contact: { on: 'iot.state.open', off: 'iot.state.closed' },
  occupancy: { on: 'iot.state.occupied', off: 'iot.state.clear' },
  smoke: { on: 'iot.state.smokeDetected', off: 'iot.state.noSmoke' },
  co: { on: 'iot.state.coDetected', off: 'iot.state.noCo' },
};

/** ¿Se muestra esta lectura como palabra (suceso) en vez de número (magnitud)? */
export function esLecturaDeEstado(metric: IotMetric): boolean {
  return metric in SECURITY_TEXT;
}

/**
 * Texto de una lectura, ya listo para pintar. Devuelve `unit` aparte porque la UI
 * la maquetea más pequeña; en los sucesos va vacía (no hay unidad que enseñar).
 */
export function describeReading(
  reading: IotReading,
  t: (key: TranslationKey) => string,
): { value: string; unit: string } {
  const estado = SECURITY_TEXT[reading.metric];
  if (estado) return { value: t(reading.value >= 1 ? estado.on : estado.off), unit: '' };
  // Los decimales largos de un sensor no aportan nada: 21.53333 → 21.5.
  const redondeado = Math.round(reading.value * 10) / 10;
  return { value: String(redondeado), unit: reading.unit };
}
