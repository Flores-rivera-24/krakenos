import type { IotDevice, IotManager, IotReading, UpdateIotStateRequest } from '@krakenos/types';
import { isControllableKind } from '@krakenos/types';
import { IotError } from './mock.iot.js';
import type { MqttTransport } from './mqtt.transport.js';
import {
  DEFAULT_DISCOVERY_PREFIX,
  type EntidadDescubierta,
  brilloDesdeEscala,
  categoriaDeEntidades,
  construirOrdenes,
  extraerValor,
  lecturaDeBinario,
  lecturaDeSensor,
  normalizarEnergia,
  parseDiscoveryConfig,
  parseDiscoveryTopic,
} from './mqtt-discovery.parsers.js';

/**
 * Ingesta genérica por **MQTT Discovery** (US-248): se suscribe al namespace de
 * anuncio (`homeassistant/#` por convención) y da de alta lo que publiquen ESPHome,
 * Tasmota, OpenBeken, Z-Wave JS UI o zigbee2mqtt — **sin un backend por marca**.
 *
 * Es la pieza estratégica de `adr-control-total.md`: se gana a la app del
 * fabricante *cambiando de capa*, no con más ingeniería inversa. Y se consume **el
 * protocolo**, no Home Assistant: los mensajes los publica el propio aparato de
 * forma retenida, HA es otro consumidor del mismo namespace (`adr-ingesta-mqtt.md`).
 *
 * La lógica de mapeo es pura (`mqtt-discovery.parsers`); aquí viven la suscripción,
 * la caché y la publicación de órdenes.
 */

/** Tope de entidades ingeridas. El broker **no tiene sujeto**: no se le fía la RAM. */
export const MAX_ENTIDADES = 500;
/** Tope de tamaño de una config. Un payload absurdo se descarta antes de parsear. */
export const MAX_PAYLOAD_BYTES = 32_768;

export interface MqttDiscoveryOptions {
  transport: MqttTransport;
  /** Prefijo del namespace de anuncio (por defecto `homeassistant`). */
  discoveryPrefix?: string;
  /** Tope de entidades; por defecto {@link MAX_ENTIDADES}. */
  maxEntidades?: number;
  /** Aviso diagnóstico (se registra en el log del agente). */
  onAviso?: (mensaje: string) => void;
}

export class MqttDiscoveryIotManager implements IotManager {
  readonly kind = 'mqtt' as const;
  private readonly prefix: string;
  private readonly maxEntidades: number;
  /** Entidades vivas, por su topic de config (que es su identidad para el alta y la baja). */
  private readonly entidades = new Map<string, EntidadDescubierta>();
  /** Último payload recibido **por topic**, no por entidad. */
  private readonly payloads = new Map<string, string>();
  /** Topics de datos ya suscritos (el transporte no deduplica: suscribir dos veces duplica el handler). */
  private readonly suscritos = new Set<string>();
  private started = false;
  private avisoDeTope = false;

  constructor(private readonly opts: MqttDiscoveryOptions) {
    this.prefix = opts.discoveryPrefix ?? DEFAULT_DISCOVERY_PREFIX;
    this.maxEntidades = opts.maxEntidades ?? MAX_ENTIDADES;
  }

  /** Suscribe al namespace de anuncio (idempotente). */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await this.opts.transport.subscribe(`${this.prefix}/#`, this.onConfig.bind(this));
  }

  /** Cierra la conexión MQTT al recargar la integración en caliente (US-201). */
  async stop(): Promise<void> {
    this.started = false;
    await this.opts.transport.dispose?.();
  }

  /** Mensaje en el namespace de anuncio: alta, baja o ruido. */
  private onConfig(topic: string, payload: string): void {
    const partes = parseDiscoveryTopic(topic, this.prefix);
    if (!partes) return; // p. ej. `homeassistant/status`, que no es una config

    // Payload vacío = **baja** (así se borra un retenido). Es la vía por la que un
    // aparato desaparece del broker, y no atenderla dejaría fantasmas para siempre.
    if (payload.trim() === '') {
      this.entidades.delete(topic);
      return;
    }
    if (payload.length > MAX_PAYLOAD_BYTES) {
      this.aviso(`Config de discovery descartada por tamaño (${payload.length} B): ${topic}`);
      return;
    }

    let json: unknown;
    try {
      json = JSON.parse(payload);
    } catch {
      return; // basura en el topic: se ignora, no se lanza
    }

    const entidad = parseDiscoveryConfig(partes, json);
    if (!entidad) return;

    if (!this.entidades.has(topic) && this.entidades.size >= this.maxEntidades) {
      if (!this.avisoDeTope) {
        this.avisoDeTope = true;
        this.aviso(
          `Se ha alcanzado el tope de ${this.maxEntidades} entidades de MQTT Discovery; se ignoran las nuevas.`,
        );
      }
      return;
    }

    this.entidades.set(topic, { ...entidad, configTopic: topic });
    void this.suscribirTopicsDe(entidad);
  }

  /**
   * Suscribe a los topics que la entidad **declara**. No se pueden conocer de
   * antemano: cada aparato publica su estado donde quiere (ESPHome bajo su propio
   * nombre, Tasmota bajo `tele/…`), así que la suscripción es dinámica y llega
   * después de la config. Los retenidos del broker cubren el hueco: al suscribirse
   * se recibe el último estado inmediatamente.
   */
  private async suscribirTopicsDe(entidad: EntidadDescubierta): Promise<void> {
    const topics = [
      entidad.stateTopic,
      entidad.brightnessStateTopic,
      entidad.positionTopic,
      entidad.temperatureStateTopic,
      entidad.currentTemperatureTopic,
      ...entidad.availability.map((a) => a.topic),
    ].filter((t): t is string => t !== null);

    for (const topic of topics) {
      if (this.suscritos.has(topic)) continue;
      this.suscritos.add(topic);
      try {
        await this.opts.transport.subscribe(topic, (t, p) => this.payloads.set(t, p));
      } catch (err) {
        this.suscritos.delete(topic);
        this.aviso(`No se pudo suscribir a ${topic}: ${(err as Error).message}`);
      }
    }
  }

  private aviso(mensaje: string): void {
    this.opts.onAviso?.(mensaje);
  }

  /** Entidades agrupadas por aparato (`deviceKey`), en orden estable. */
  private porAparato(): Map<string, EntidadDescubierta[]> {
    const mapa = new Map<string, EntidadDescubierta[]>();
    for (const entidad of this.entidades.values()) {
      const lista = mapa.get(entidad.deviceKey);
      if (lista) lista.push(entidad);
      else mapa.set(entidad.deviceKey, [entidad]);
    }
    return mapa;
  }

  /** Valor actual de una entidad según su topic de estado y su plantilla. */
  private valorDe(entidad: EntidadDescubierta): string | null {
    if (!entidad.stateTopic) return null;
    const payload = this.payloads.get(entidad.stateTopic);
    if (payload === undefined) return null;
    return extraerValor(entidad.plantilla, payload);
  }

  private numeroDe(topic: string | null): number | null {
    if (!topic) return null;
    const payload = this.payloads.get(topic);
    if (payload === undefined) return null;
    const n = Number(payload);
    return Number.isFinite(n) ? n : null;
  }

  /**
   * ¿Responde el aparato? Un `offline` en **cualquiera** de sus topics de
   * disponibilidad basta para decir que no: es la lectura conservadora, y es la que
   * evita pintar como vivo algo que su propio LWT ya declaró muerto.
   */
  private alcanzable(entidades: EntidadDescubierta[]): boolean {
    for (const entidad of entidades) {
      for (const regla of entidad.availability) {
        const payload = this.payloads.get(regla.topic);
        if (payload !== undefined && payload.trim() === regla.offline) return false;
      }
    }
    return true;
  }

  private toDevice(deviceKey: string, entidades: EntidadDescubierta[]): IotDevice {
    const kind = categoriaDeEntidades(entidades);
    const principal = entidades.find((e) => e.component === 'light' || e.component === 'switch');
    const reachable = this.alcanzable(entidades);

    const readings: IotReading[] = [];
    let powerW: number | null = null;
    let energyWh: number | null = null;
    for (const entidad of entidades) {
      const valor = this.valorDe(entidad);
      if (valor === null) continue;
      const lectura =
        entidad.component === 'sensor'
          ? lecturaDeSensor(entidad, valor)
          : entidad.component === 'binary_sensor'
            ? lecturaDeBinario(entidad, valor)
            : null;
      if (!lectura) continue;
      readings.push(lectura);
      const energia = normalizarEnergia(lectura);
      if (energia.powerW !== undefined) powerW = energia.powerW;
      if (energia.energyWh !== undefined) energyWh = energia.energyWh;
    }

    // La temperatura ACTUAL de un termostato es una medida del aparato, así que va
    // como lectura; `targetC` es la consigna, que es otra cosa y se pide aparte.
    const climate = entidades.find((e) => e.component === 'climate');
    const actual = this.numeroDe(climate?.currentTemperatureTopic ?? null);
    if (actual !== null) readings.push({ metric: 'temperature', value: actual, unit: '°C' });

    const valorPrincipal = principal ? this.valorDe(principal) : null;
    const on =
      principal && valorPrincipal !== null && (kind === 'light' || kind === 'plug')
        ? valorPrincipal === principal.payloadOn
          ? true
          : valorPrincipal === principal.payloadOff
            ? false
            : null
        : null;

    const brilloBruto = principal?.brightnessStateTopic
      ? this.payloads.get(principal.brightnessStateTopic)
      : undefined;
    const brilloTexto =
      brilloBruto !== undefined && principal
        ? extraerValor(principal.brightnessPlantilla, brilloBruto)
        : null;
    const brightness =
      kind === 'light' && brilloTexto !== null && Number.isFinite(Number(brilloTexto))
        ? brilloDesdeEscala(Number(brilloTexto), principal?.brightnessScale ?? 255)
        : null;

    const cover = entidades.find((e) => e.component === 'cover');
    const posicionBruta = this.numeroDe(cover?.positionTopic ?? null);
    const rango = cover ? cover.positionOpen - cover.positionClosed : 0;
    const position =
      kind === 'cover' && posicionBruta !== null && cover && rango !== 0
        ? Math.round(((posicionBruta - cover.positionClosed) / rango) * 100)
        : null;

    const targetC = kind === 'climate' ? this.numeroDe(climate?.temperatureStateTopic ?? null) : null;

    const lock = entidades.find((e) => e.component === 'lock');
    const valorCerradura = lock ? this.valorDe(lock) : null;
    const locked =
      kind === 'lock' && valorCerradura !== null
        ? valorCerradura.toUpperCase() === 'LOCKED'
          ? true
          : valorCerradura.toUpperCase() === 'UNLOCKED'
            ? false
            : null
        : null;

    // US-242: un aparato que no responde se lista, pero sus estados van a `null` y
    // sus lecturas a `[]`. El último valor conocido tendría pinta de dato fresco.
    if (!reachable) {
      return {
        id: deviceKey,
        name: entidades[0]?.deviceName ?? deviceKey,
        kind,
        room: null,
        reachable: false,
        on: null,
        brightness: null,
        color: null,
        readings: [],
        position: null,
        targetC: null,
        locked: null,
        powerW: null,
        energyWh: null,
      };
    }

    return {
      id: deviceKey,
      name: entidades[0]?.deviceName ?? deviceKey,
      kind,
      room: null,
      reachable: true,
      on,
      brightness,
      // El color no viaja en este baseline: `rgb_state_topic` admite plantillas y
      // varios espacios de color (rgb/hs/xy), y adivinarlos pintaría un color falso.
      color: null,
      readings,
      position,
      targetC,
      locked,
      powerW,
      energyWh,
    };
  }

  async listDevices(): Promise<IotDevice[]> {
    return [...this.porAparato().entries()]
      .map(([key, entidades]) => this.toDevice(key, entidades))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  async getDevice(id: string): Promise<IotDevice | null> {
    const entidades = this.porAparato().get(id);
    return entidades ? this.toDevice(id, entidades) : null;
  }

  async setState(id: string, input: UpdateIotStateRequest): Promise<IotDevice> {
    const entidades = this.porAparato().get(id);
    if (!entidades) throw new IotError('IOT_NOT_FOUND', 'Dispositivo no encontrado');

    const kind = categoriaDeEntidades(entidades);
    // `lock` cae aquí a propósito: no está en `CONTROLLABLE_IOT_KINDS` hasta que
    // US-246 decida la política de desbloqueo (US-244).
    if (!isControllableKind(kind)) {
      throw new IotError('IOT_NOT_CONTROLLABLE', 'Este dispositivo no acepta órdenes');
    }

    const ordenes = construirOrdenes(entidades, kind, input);
    if (ordenes.length === 0) {
      // El aparato no declaró el topic de control necesario. Publicar en uno
      // inventado sería mandar la orden al vacío y responder «hecho».
      throw new IotError(
        'IOT_NOT_CONTROLLABLE',
        'El dispositivo no publica un control para esa acción',
      );
    }
    for (const orden of ordenes) {
      await this.opts.transport.publish(orden.topic, orden.payload);
    }

    // Actualización optimista: el aparato confirmará por su topic de estado.
    const principal = entidades.find((e) => e.component === 'light' || e.component === 'switch');
    if (input.on !== undefined && principal?.stateTopic && principal.plantilla.tipo === 'directa') {
      this.payloads.set(principal.stateTopic, input.on ? principal.payloadOn : principal.payloadOff);
    }
    return this.toDevice(id, entidades);
  }
}
