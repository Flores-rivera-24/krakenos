/**
 * Proveedor de tiempo exterior (US-254) — **parte pura**: redondeo de ubicación,
 * construcción de la URL y parseo de la respuesta. Sin I/O, sin estado.
 *
 * Open-Meteo autoriza textualmente el uso «personal home automation» en su tier
 * gratuito y no pide clave. La decisión de **no autohospedarlo** está tomada: su
 * imagen pide ~8 GB de RAM y el objetivo es una Raspberry.
 */

import type { WeatherMetric, WeatherPrecision, WeatherReading } from '@krakenos/types';
import { WEATHER_METRICS, WEATHER_PROVIDER_HOST } from '@krakenos/types';

export interface HomeLocation {
  lat: number;
  lon: number;
}

/**
 * Grados de redondeo en modo `rounded`. 0,1° ≈ 11 km en latitud: el tiempo a esa
 * escala es el mismo, así que la privacidad no se paga con exactitud. Menos
 * redondeo no protegería nada; más empezaría a dar el tiempo de otro sitio.
 */
const PASO_REDONDEO = 0.1;

/**
 * Ubicación tal y como se enviará al proveedor.
 *
 * ⚠️ Redondear es **cuantizar a una rejilla**, no truncar: truncar conserva el
 * signo del error y sigue apuntando siempre al mismo lado de la casa. Y se
 * normaliza con `toFixed` porque `Math.round(x/0.1)*0.1` arrastra el error
 * binario (41,4 sale como 41,400000000000006) y eso viajaría en la URL,
 * delatando que detrás hay una coordenada más precisa.
 */
export function ubicacionEnviada(loc: HomeLocation, precision: WeatherPrecision): HomeLocation {
  if (precision === 'exact') return { lat: loc.lat, lon: loc.lon };
  const cuantiza = (v: number) => Number((Math.round(v / PASO_REDONDEO) * PASO_REDONDEO).toFixed(1));
  return { lat: cuantiza(loc.lat), lon: cuantiza(loc.lon) };
}

/** ¿Es una ubicación utilizable? (misma validación que el horario solar). */
export function esUbicacionValida(loc: HomeLocation): boolean {
  const { lat, lon } = loc;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

/** Campo de la API por cada magnitud del contrato. */
const CAMPO_API: Record<WeatherMetric, string> = {
  temperature: 'temperature_2m',
  precipitation: 'precipitation',
  wind: 'wind_speed_10m',
};

/**
 * URL de consulta. Pide **solo** los tres campos del contrato: no se traen datos
 * que no se usan, porque lo que no se pide tampoco hay que decidir si se guarda.
 */
export function construirUrl(loc: HomeLocation): string {
  const url = new URL(`https://${WEATHER_PROVIDER_HOST}/v1/forecast`);
  url.searchParams.set('latitude', String(loc.lat));
  url.searchParams.set('longitude', String(loc.lon));
  url.searchParams.set('current', WEATHER_METRICS.map((m) => CAMPO_API[m]).join(','));
  return url.toString();
}

/**
 * Parsea la respuesta a lecturas del contrato. Defensivo a propósito: es entrada
 * de red, así que un campo ausente o no numérico **se omite** en vez de colarse
 * como `NaN` —que compararía `false` contra cualquier umbral y dejaría una regla
 * muda sin un solo error—.
 */
export function parsearLecturas(body: unknown): WeatherReading[] {
  if (typeof body !== 'object' || body === null) return [];
  const current = (body as { current?: unknown }).current;
  if (typeof current !== 'object' || current === null) return [];
  const campos = current as Record<string, unknown>;

  const lecturas: WeatherReading[] = [];
  for (const metric of WEATHER_METRICS) {
    const bruto = campos[CAMPO_API[metric]];
    if (typeof bruto !== 'number' || !Number.isFinite(bruto)) continue;
    lecturas.push({ metric, value: bruto });
  }
  return lecturas;
}
