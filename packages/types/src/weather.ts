/**
 * Datos externos del tiempo (US-254) — **opt-in y declarado**.
 *
 * Es la primera vez que KrakenOS manda un dato **del hogar** a un tercero. El
 * resto de la interop es saliente hacia sistemas del propio usuario (su broker,
 * su Home Assistant); esto es una petición a `open-meteo.com`, y para preguntar
 * el tiempo hay que decir **dónde**.
 *
 * `homeLatitude`/`homeLongitude` están clasificadas como PII: se omiten del
 * bundle de soporte (US-192) y desde AUD3-02 solo las lee un admin. Mandarlas
 * fuera sin permiso contradiría esas dos decisiones, así que:
 *
 * - **`enabled` es OFF por defecto** y sin él no sale **ni una** petición
 *   (mismo contrato que `UPDATE_CHECK_REPO`, US-116).
 * - La precisión es del usuario: `rounded` recorta a ~11 km, que sigue dando el
 *   tiempo correcto y **no señala la casa**.
 * - El estado publica **las coordenadas exactas que se envían**, no las que hay
 *   guardadas: un ajuste de privacidad que no enseña su efecto es decorativo.
 */

/**
 * Magnitudes soportadas. Unión **cerrada** a propósito, por la misma razón que
 * `IotMetric`: lo que dispara una regla lo decide la magnitud, no el número.
 * Ampliarla es una decisión, no un descuido.
 */
export const WEATHER_METRICS = ['temperature', 'precipitation', 'wind'] as const;
export type WeatherMetric = (typeof WEATHER_METRICS)[number];

/** Unidad de cada magnitud, para que la UI no la invente. */
export const WEATHER_UNITS: Record<WeatherMetric, string> = {
  temperature: '°C',
  precipitation: 'mm',
  wind: 'km/h',
};

/**
 * Con cuánta precisión se envía la ubicación al proveedor.
 *
 * `rounded` redondea a 0,1° (~11 km en latitud). El tiempo a esa escala es el
 * mismo, así que el usuario no paga exactitud por privacidad — que es lo que
 * hace la opción aceptable en vez de un gesto simbólico.
 */
export const WEATHER_PRECISIONS = ['rounded', 'exact'] as const;
export type WeatherPrecision = (typeof WEATHER_PRECISIONS)[number];

/** Proveedor único, declarado. No es configurable: cambiarlo es una decisión. */
export const WEATHER_PROVIDER_HOST = 'api.open-meteo.com';

/** Configuración (`PUT /api/weather`, admin, auditada). */
export interface WeatherConfig {
  /** Opt-in explícito. Sin esto no sale ninguna petición. */
  enabled: boolean;
  precision: WeatherPrecision;
}

/** Una lectura del tiempo exterior. */
export interface WeatherReading {
  metric: WeatherMetric;
  value: number;
}

/** Estado (`GET /api/weather`). */
export interface WeatherStatus {
  enabled: boolean;
  precision: WeatherPrecision;
  /** Host al que se pregunta, para que la UI no lo escriba a mano. */
  provider: string;
  /**
   * ¿Hay ubicación configurada? Sin ella no se puede preguntar el tiempo, y es
   * un estado distinto de «apagado»: uno se arregla en Ajustes → Sistema y el
   * otro aquí. Verlos iguales manda al usuario al sitio equivocado.
   */
  locationConfigured: boolean;
  /**
   * Las coordenadas **que se envían** (ya redondeadas si procede), o `null` si
   * está apagado o no hay ubicación. Es el efecto del ajuste, hecho visible.
   */
  sentLatitude: number | null;
  sentLongitude: number | null;
  readings: WeatherReading[];
  /** Instante de la última lectura conseguida. */
  lastFetchAt: string | null;
  /**
   * Último fallo, en claro. Un dato externo que no llega **se dice**: si no, una
   * regla que no dispara parece un fallo de la regla.
   */
  lastError: string | null;
}

/** Cambios de configuración (`PUT /api/weather`). */
export interface UpdateWeatherConfigRequest {
  enabled?: boolean;
  precision?: WeatherPrecision;
}
