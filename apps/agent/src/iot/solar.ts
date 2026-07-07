/**
 * Cálculo solar **puro y local** de amanecer/atardecer (US-168), sin dependencias
 * ni llamadas externas. Implementa la ecuación estándar del amanecer (NOAA /
 * Wikipedia "Sunrise equation"). Devuelve el instante **UTC** del evento; el
 * evaluador de horarios lo convierte a minutos del día en hora local.
 *
 * Precisión: del orden de ±1-2 minutos, más que suficiente para "encender al
 * atardecer". En latitudes polares puede no haber amanecer/atardecer un día dado
 * (sol de medianoche / noche polar) → devuelve `null`.
 */

const DEG = Math.PI / 180;
/** Ángulo del centro solar bajo el horizonte en el orto/ocaso (refracción incl.). */
const ZENITH = -0.833;

/** Día juliano (número entero) a las 00:00 UTC de una fecha del calendario gregoriano. */
function julianDayNumber(year: number, month: number, day: number): number {
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  return (
    day +
    Math.floor((153 * m + 2) / 5) +
    365 * y +
    Math.floor(y / 4) -
    Math.floor(y / 100) +
    Math.floor(y / 400) -
    32045
  );
}

/** Día juliano → instante `Date` (UTC). */
function julianToDate(jd: number): Date {
  // JD 2440587.5 = epoch Unix (1970-01-01T00:00Z).
  return new Date((jd - 2440587.5) * 86_400_000);
}

/**
 * Instante UTC del amanecer o atardecer para la fecha (año/mes/día en UTC) y la
 * posición dada, o `null` si ese día no hay evento (latitud polar). `lat`/`lon` en
 * grados; `lon` positivo al este.
 */
export function sunEventUtc(
  year: number,
  month: number,
  day: number,
  lat: number,
  lon: number,
  which: 'sunrise' | 'sunset',
): Date | null {
  const jdate = julianDayNumber(year, month, day);
  // n = número de días (ciclos solares) desde 2000-01-01, ajustado.
  const n = jdate - 2451545 + 0.0008;
  const meanSolarNoon = n - lon / 360;

  const solarAnomaly = (357.5291 + 0.98560028 * meanSolarNoon) % 360;
  const M = solarAnomaly * DEG;
  const center =
    1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M);
  const eclipticLong = ((solarAnomaly + center + 180 + 102.9372) % 360) * DEG;

  const solarTransit =
    2451545 +
    meanSolarNoon +
    0.0053 * Math.sin(M) -
    0.0069 * Math.sin(2 * eclipticLong);

  const declination = Math.asin(Math.sin(eclipticLong) * Math.sin(23.44 * DEG));

  const latRad = lat * DEG;
  const cosHourAngle =
    (Math.sin(ZENITH * DEG) - Math.sin(latRad) * Math.sin(declination)) /
    (Math.cos(latRad) * Math.cos(declination));

  // |cos| > 1 → el sol no cruza el horizonte ese día (polar).
  if (cosHourAngle > 1 || cosHourAngle < -1) return null;

  const hourAngle = Math.acos(cosHourAngle) / DEG; // grados
  const jEvent =
    which === 'sunset'
      ? solarTransit + hourAngle / 360
      : solarTransit - hourAngle / 360;

  return julianToDate(jEvent);
}

/**
 * Minutos del día en **hora local** del amanecer/atardecer para una fecha local
 * dada, o `null` si no hay evento. Usa la fecha local (`getFullYear`…) para elegir
 * el día y lee la hora local del instante UTC calculado — así respeta la zona
 * horaria del servidor sin librerías de tz.
 */
export function sunEventLocalMinutes(
  date: Date,
  lat: number,
  lon: number,
  which: 'sunrise' | 'sunset',
): number | null {
  const event = sunEventUtc(date.getFullYear(), date.getMonth() + 1, date.getDate(), lat, lon, which);
  if (!event) return null;
  return event.getHours() * 60 + event.getMinutes();
}
