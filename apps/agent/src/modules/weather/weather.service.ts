import type { FastifyInstance } from 'fastify';
import type {
  UpdateWeatherConfigRequest,
  WeatherConfig,
  WeatherReading,
  WeatherStatus,
} from '@krakenos/types';
import { WEATHER_PROVIDER_HOST } from '@krakenos/types';
import { safeFetch } from '../../net/egress.js';
import { createTickLoop, type TickLoop } from '../../system/tick-loop.js';
import type { HomeEventBus } from '../../automations/event-bus.js';
import {
  construirUrl,
  esUbicacionValida,
  parsearLecturas,
  ubicacionEnviada,
  type HomeLocation,
} from '../../weather/open-meteo.js';

/**
 * Tiempo exterior como disparador de rutinas (US-254).
 *
 * **Opt-in duro:** con `enabled: false` no sale ni una petición — no es que se
 * ignore la respuesta, es que no se pregunta. Mismo contrato que el
 * update-check (US-116), y aquí importa más porque lo que viaja es la ubicación
 * de la casa.
 *
 * Caché horaria: el tiempo no cambia en cinco minutos y Open-Meteo es un
 * servicio gratuito que se usa por cortesía. Un sondeo agresivo sería la forma
 * más rápida de que dejara de estar disponible para todos.
 */

export const WEATHER_SETTING_KEY = 'weather.config';

/** Una hora. El dato tiene resolución horaria: pedir más a menudo no aporta. */
const INTERVALO_MS = 60 * 60 * 1000;

/** Tope de la petición. Sin él, un proveedor colgado retiene el barrido. */
const TIMEOUT_MS = 10_000;

export const DEFAULT_WEATHER_CONFIG: WeatherConfig = {
  // OFF por defecto: mandar la ubicación fuera es una decisión del usuario, no
  // un valor por defecto que se descubre después.
  enabled: false,
  // Si acepta, lo hace con el ajuste protector puesto. Que la opción privada
  // sea el default es lo que la hace real y no un gesto.
  precision: 'rounded',
};

export type WeatherFetch = (url: string) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

const defaultFetch: WeatherFetch = (url) =>
  safeFetch(url, {
    headers: { 'User-Agent': 'KrakenOS', Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

export interface WeatherServiceOptions {
  bus?: HomeEventBus;
  fetchFn?: WeatherFetch;
  now?: () => Date;
}

export class WeatherService {
  private loop: TickLoop | null = null;
  private readings: WeatherReading[] = [];
  /** Última lectura por magnitud, para el flanco del motor. */
  private prev = new Map<string, number>();
  private lastFetchAt: string | null = null;
  private lastError: string | null = null;

  private readonly fetchFn: WeatherFetch;
  private readonly now: () => Date;

  constructor(
    private readonly app: FastifyInstance,
    private readonly opts: WeatherServiceOptions = {},
  ) {
    this.fetchFn = opts.fetchFn ?? defaultFetch;
    this.now = opts.now ?? (() => new Date());
  }

  // ---- Configuración ----

  async getConfig(): Promise<WeatherConfig> {
    const row = await this.app.prisma.setting.findUnique({ where: { key: WEATHER_SETTING_KEY } });
    if (!row) return { ...DEFAULT_WEATHER_CONFIG };
    try {
      const raw = JSON.parse(row.value) as Partial<WeatherConfig>;
      return {
        enabled: typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULT_WEATHER_CONFIG.enabled,
        precision:
          raw.precision === 'exact' || raw.precision === 'rounded'
            ? raw.precision
            : DEFAULT_WEATHER_CONFIG.precision,
      };
    } catch (err) {
      // Un JSON corrupto NO puede degradar a «encendido»: ante la duda, no se
      // manda la ubicación a ninguna parte.
      this.app.log.warn({ err }, '[weather] configuración ilegible; se usa el valor por defecto');
      return { ...DEFAULT_WEATHER_CONFIG };
    }
  }

  async saveConfig(patch: UpdateWeatherConfigRequest): Promise<WeatherConfig> {
    const current = await this.getConfig();
    const next: WeatherConfig = {
      enabled: patch.enabled ?? current.enabled,
      precision: patch.precision ?? current.precision,
    };
    await this.app.prisma.setting.upsert({
      where: { key: WEATHER_SETTING_KEY },
      create: { key: WEATHER_SETTING_KEY, value: JSON.stringify(next) },
      update: { value: JSON.stringify(next) },
    });
    // Apagar borra lo que ya se había traído: dejar lecturas de ayer en pantalla
    // después de revocar el permiso parecería que se sigue consultando.
    if (!next.enabled) {
      this.readings = [];
      this.prev.clear();
      this.lastFetchAt = null;
      this.lastError = null;
    }
    return next;
  }

  // ---- Ubicación ----

  /** Ubicación del hogar desde `Setting`, o `null` si no está configurada. */
  private async homeLocation(): Promise<HomeLocation | null> {
    const rows = await this.app.prisma.setting.findMany({
      where: { key: { in: ['homeLatitude', 'homeLongitude'] } },
    });
    const map = new Map(rows.map((r) => [r.key, r.value]));
    const loc = { lat: Number(map.get('homeLatitude')), lon: Number(map.get('homeLongitude')) };
    return esUbicacionValida(loc) ? loc : null;
  }

  // ---- Estado ----

  async getStatus(): Promise<WeatherStatus> {
    const config = await this.getConfig();
    const loc = await this.homeLocation();
    // Solo se publica la coordenada cuando de verdad se está enviando: si está
    // apagado no hay nada que declarar, y enseñarla sugeriría lo contrario.
    const enviada = config.enabled && loc ? ubicacionEnviada(loc, config.precision) : null;
    return {
      enabled: config.enabled,
      precision: config.precision,
      provider: WEATHER_PROVIDER_HOST,
      locationConfigured: loc !== null,
      sentLatitude: enviada?.lat ?? null,
      sentLongitude: enviada?.lon ?? null,
      readings: this.readings,
      lastFetchAt: this.lastFetchAt,
      lastError: this.lastError,
    };
  }

  // ---- Barrido ----

  /**
   * Un ciclo. Devuelve las lecturas conseguidas (vacío si no procede consultar).
   * Público para el test y para el ciclo inmediato al activar.
   */
  async refresh(): Promise<WeatherReading[]> {
    const config = await this.getConfig();
    if (!config.enabled) return [];

    const loc = await this.homeLocation();
    if (!loc) {
      // No es un error del proveedor: es que falta un dato del propio usuario, y
      // decirlo así lo manda a Ajustes → Sistema en vez de a mirar su red.
      this.lastError = 'Falta la ubicación del hogar (Ajustes → Sistema).';
      return [];
    }

    const url = construirUrl(ubicacionEnviada(loc, config.precision));
    let lecturas: WeatherReading[];
    try {
      const res = await this.fetchFn(url);
      if (!res.ok) {
        this.lastError = `El proveedor respondió con un error (${WEATHER_PROVIDER_HOST}).`;
        return [];
      }
      lecturas = parsearLecturas(await res.json());
    } catch (err) {
      this.app.log.warn({ err }, '[weather] no se pudo consultar el tiempo');
      this.lastError = 'No se pudo contactar con el proveedor del tiempo.';
      return [];
    }

    if (lecturas.length === 0) {
      this.lastError = 'El proveedor no devolvió ninguna medida reconocible.';
      return [];
    }

    // La ventana avanza DESPUÉS del await y solo si salió bien: un fallo no
    // puede darse por leído ni pisar el `prevValue` que calcula el flanco.
    this.lastError = null;
    this.lastFetchAt = this.now().toISOString();
    for (const lectura of lecturas) {
      const anterior = this.prev.get(lectura.metric) ?? null;
      this.opts.bus?.publish({
        type: 'weather-reading',
        metric: lectura.metric,
        value: lectura.value,
        prevValue: anterior,
      });
      this.prev.set(lectura.metric, lectura.value);
    }
    this.readings = lecturas;
    return lecturas;
  }

  start(intervalMs = INTERVALO_MS): void {
    if (this.loop) return;
    this.loop = createTickLoop({
      intervalMs,
      tick: () => this.refresh().then(() => undefined),
      onError: (err) => this.app.log.error({ err }, '[weather] el barrido del tiempo falló'),
    });
    this.loop.start();
  }

  stop(): void {
    this.loop?.stop();
    this.loop = null;
  }
}
