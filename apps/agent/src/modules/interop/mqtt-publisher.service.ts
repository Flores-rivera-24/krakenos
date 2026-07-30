import type { PrismaClient } from '@prisma/client';
import type {
  MqttPublishConfig,
  MqttPublishStatus,
  UpdateIotStateRequest,
  UpdateMqttPublishRequest,
} from '@krakenos/types';
import type { Secretbox } from '../../config/secretbox.js';
import {
  assertHostAllowed,
  DEFAULT_EGRESS_POLICY,
  extractHost,
  type EgressPolicy,
} from '../../net/egress.js';
import {
  MqttClientTransport,
  type MqttClientOptions,
  type MqttTransport,
} from '../../iot/mqtt.transport.js';
import { createTickLoop, type TickLoop } from '../../system/tick-loop.js';
import {
  AVAILABILITY_ONLINE,
  availabilityTopic,
  buildDiscoveryConfigs,
  buildStateMessages,
  commandFilters,
  offlineMessage,
  parseInboundCommand,
  removalMessage,
  willMessage,
  type ControlFlags,
  type StateSnapshot,
} from './ha-discovery.js';

export type { StateSnapshot } from './ha-discovery.js';

/**
 * Publicación de estados a un broker MQTT **local** (US-174). Opt-in (off por
 * defecto). Publica estados de IoT, energía y un resumen del inventario para
 * integrar con Home Assistant/Node-RED sin ceder la contraseña de KrakenOS.
 *
 * Diseño mock-first: el transporte es **inyectable** (real `MqttClientTransport`
 * carga `mqtt` de forma perezosa, verificado en despliegue US-86; en tests un
 * doble captura lo publicado). Antes de conectar, el host del broker pasa por la
 * **política de egress** (no puede apuntar a metadata de nube). La contraseña se
 * cifra en reposo (secretbox) y **nunca** sale por la API ni en los payloads.
 */

export type SnapshotSource = () => Promise<StateSnapshot>;
export type MqttTransportFactory = (opts: MqttClientOptions) => MqttTransport;

/** Aplica un comando entrante (US-213): `setState` + anti-bucle + auditoría. */
export type CommandHandler = (deviceId: string, state: UpdateIotStateRequest) => Promise<void>;

/** Aplica una pausa de internet entrante (US-236): `deviceId` es `Device.id`, no la MAC. */
export type PauseHandler = (deviceId: string, minutes: number) => Promise<void>;

interface StoredConfig {
  enabled: boolean;
  url: string;
  username: string;
  /** Contraseña cifrada (token `kbx1.*`) o cadena vacía si no hay. */
  passwordEnc: string;
  topicPrefix: string;
  intervalSec: number;
  /** MQTT Discovery de HA (US-213). */
  discovery: boolean;
  /** Control entrante de IoT (US-213); separado de `discovery`. */
  control: boolean;
  /**
   * Control entrante de **pausa de internet** (US-236). Toggle **propio** y OFF por
   * defecto: `control` significa «HA puede tocar mis aparatos IoT», no «HA puede
   * cortarle internet a mi hija». La ruta HTTP equivalente es admin-only y rechaza
   * tokens de API, y el broker **no tiene sujeto**, así que mezclarlos sería una
   * escalada de privilegio.
   */
  pauseControl: boolean;
}

const SETTING_KEY = 'interop.mqtt';
const DEFAULTS: StoredConfig = {
  enabled: false,
  url: '',
  username: '',
  passwordEnc: '',
  topicPrefix: 'krakenos',
  intervalSec: 30,
  discovery: false,
  control: false,
  pauseControl: false,
};
const MIN_INTERVAL_SEC = 5;
const MAX_INTERVAL_SEC = 3600;

export interface MqttPublisherDeps {
  prisma: PrismaClient;
  secretbox: Secretbox;
  snapshot: SnapshotSource;
  transportFactory?: MqttTransportFactory;
  egressPolicy?: EgressPolicy;
  now?: () => Date;
  /** Log de errores (por defecto silencioso; el server inyecta el logger). */
  onError?: (msg: string) => void;
  /**
   * Aplica un comando entrante (US-213). El server lo cablea a `setState` +
   * `withActionTimeout` + publicación al bus con `origin:'mqtt'` (anti-bucle) +
   * auditoría. Sin él, el control entrante no hace nada aunque esté activado.
   */
  onCommand?: CommandHandler;
  /**
   * Aplica una pausa de internet entrante (US-236). El server la cablea a
   * `AccessScheduleService.pause` + auditoría con **actor `mqtt`**. Sin él, el
   * botón de HA no hace nada aunque su toggle esté activo.
   */
  onPause?: PauseHandler;
}

export class MqttPublisher {
  private readonly transportFactory: MqttTransportFactory;
  private readonly egressPolicy: EgressPolicy;
  private readonly now: () => Date;
  private transport: MqttTransport | null = null;
  private loop: TickLoop | null = null;
  private connected = false;
  private lastPublishAt: Date | null = null;
  private lastError: string | null = null;
  /**
   * Configs de discovery ya publicadas (topic → payload). Sirve para dos cosas:
   * limpiar los retenidos de lo que desaparece **y** no reenviar en cada tick una
   * config que no ha cambiado. Con 40 dispositivos son ~99 configs: republicarlas
   * cada 30 s era ruido puro contra el broker. Se vacía al (re)conectar, así que
   * cada conexión nueva resincroniza todo.
   */
  private lastConfigs = new Map<string, string>();

  constructor(private readonly deps: MqttPublisherDeps) {
    this.transportFactory = deps.transportFactory ?? ((opts) => new MqttClientTransport(opts));
    this.egressPolicy = deps.egressPolicy ?? DEFAULT_EGRESS_POLICY;
    this.now = deps.now ?? (() => new Date());
  }

  /** Lee la config guardada (parseo defensivo, patrón US-63). */
  private async readStored(): Promise<StoredConfig> {
    const row = await this.deps.prisma.setting.findUnique({ where: { key: SETTING_KEY } });
    if (!row) return { ...DEFAULTS };
    try {
      const parsed = JSON.parse(row.value) as Partial<StoredConfig>;
      return {
        enabled: parsed.enabled === true,
        url: typeof parsed.url === 'string' ? parsed.url : '',
        username: typeof parsed.username === 'string' ? parsed.username : '',
        passwordEnc: typeof parsed.passwordEnc === 'string' ? parsed.passwordEnc : '',
        topicPrefix: typeof parsed.topicPrefix === 'string' && parsed.topicPrefix ? parsed.topicPrefix : 'krakenos',
        intervalSec: clampInterval(parsed.intervalSec),
        discovery: parsed.discovery === true,
        control: parsed.control === true,
        pauseControl: parsed.pauseControl === true,
      };
    } catch {
      return { ...DEFAULTS };
    }
  }

  async getConfig(): Promise<MqttPublishConfig> {
    const c = await this.readStored();
    return {
      enabled: c.enabled,
      url: c.url,
      username: c.username,
      hasPassword: c.passwordEnc !== '',
      topicPrefix: c.topicPrefix,
      intervalSec: c.intervalSec,
      discovery: c.discovery,
      control: c.control,
      pauseControl: c.pauseControl,
    };
  }

  getStatus(): MqttPublishStatus {
    return {
      enabled: this.loop !== null,
      connected: this.connected,
      lastPublishAt: this.lastPublishAt?.toISOString() ?? null,
      lastError: this.lastError,
    };
  }

  /** Guarda la config (cifra la contraseña; `null` la borra; omitir la conserva). */
  async setConfig(req: UpdateMqttPublishRequest): Promise<MqttPublishConfig> {
    const cur = await this.readStored();
    const next: StoredConfig = {
      enabled: req.enabled ?? cur.enabled,
      url: req.url ?? cur.url,
      username: req.username ?? cur.username,
      passwordEnc:
        req.password === undefined
          ? cur.passwordEnc
          : req.password === null || req.password === ''
            ? ''
            : this.deps.secretbox.encrypt(req.password),
      topicPrefix: req.topicPrefix ?? cur.topicPrefix,
      intervalSec: req.intervalSec !== undefined ? clampInterval(req.intervalSec) : cur.intervalSec,
      discovery: req.discovery ?? cur.discovery,
      control: req.control ?? cur.control,
      pauseControl: req.pauseControl ?? cur.pauseControl,
    };
    await this.deps.prisma.setting.upsert({
      where: { key: SETTING_KEY },
      create: { key: SETTING_KEY, value: JSON.stringify(next) },
      update: { value: JSON.stringify(next) },
    });
    // Aplica en caliente: reinicia el barrido con la nueva config.
    await this.start();
    return this.getConfig();
  }

  /** (Re)arranca la publicación según la config: conecta + temporiza, o para. */
  async start(): Promise<void> {
    await this.stop();
    const c = await this.readStored();
    if (!c.enabled || !c.url) return;

    // Egress: el host del broker no puede apuntar a metadata de nube/link-local.
    try {
      await assertHostAllowed(extractHost(c.url), this.egressPolicy, { allowUnresolvable: false });
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : 'Broker bloqueado por la política de egress';
      this.deps.onError?.(this.lastError);
      return;
    }

    // Conexión nueva ⇒ se republica todo el discovery (por si el broker perdió
    // los retenidos), y a partir de ahí solo lo que cambie.
    this.lastConfigs = new Map();
    const password = c.passwordEnc ? this.safeDecrypt(c.passwordEnc) : undefined;
    const will = willMessage(c.topicPrefix);
    this.transport = this.transportFactory({
      url: c.url,
      username: c.username || undefined,
      password,
      // Testamento (US-236): si el agente muere de golpe, el broker publica
      // `offline` por nosotros y HA deja de mostrar la casa como disponible. Se
      // declara en el CONNECT, así que tiene que ir aquí y no al publicar.
      will: { topic: will.topic, payload: will.payload, retain: true },
    });
    this.lastError = null;

    // Control entrante: cada superficie con su propio toggle, ambos OFF por
    // defecto. Solo se suscriben los filtros de lo que está activado — con un
    // broker sin sujeto, NO suscribirse es la única garantía real.
    const flags = this.controlFlags(c);
    const filters = commandFilters(c.topicPrefix, flags);
    for (const filter of filters) {
      await this.transport.subscribe(filter, (topic, payload) => {
        const cmd = parseInboundCommand(topic, payload, c.topicPrefix);
        if (!cmd) return;
        const applied =
          cmd.kind === 'iot'
            ? this.deps.onCommand?.(cmd.deviceId, cmd.state)
            : this.deps.onPause?.(cmd.deviceId, cmd.minutes);
        void applied?.catch((err: unknown) => {
          this.deps.onError?.(err instanceof Error ? err.message : 'Error al aplicar comando MQTT');
        });
      });
    }

    // `publishOnce` no lanza; el bucle aporta el guard de re-entrada (US-229):
    // el snapshot consulta IoT y energía, y con un broker lento dos publicaciones
    // podían solaparse. `immediate` mantiene la primera publicación inmediata.
    this.loop = createTickLoop({
      intervalMs: c.intervalSec * 1000,
      immediate: true,
      tick: () => this.publishOnce(),
      onSkip: () =>
        this.deps.onError?.('La publicación MQTT anterior sigue en curso; se salta este ciclo'),
    });
    this.loop.start();
  }

  /** Publica una foto del estado en los topics. No lanza. */
  async publishOnce(): Promise<void> {
    if (!this.transport) return;
    try {
      const snap = await this.deps.snapshot();
      const c = await this.readStored();
      const p = c.topicPrefix;
      // Retenido: es el topic de disponibilidad que respalda el LWT, así que un HA
      // que se conecte después debe encontrarlo (antes iba sin `retain`).
      await this.transport.publish(availabilityTopic(p), AVAILABILITY_ONLINE, { retain: true });
      for (const d of snap.iot) {
        await this.transport.publish(
          `${p}/iot/${encodeTopic(d.id)}`,
          JSON.stringify({ name: d.name, on: d.on, brightness: d.brightness ?? null, powerW: d.powerW ?? null }),
        );
      }
      if (snap.energy) await this.transport.publish(`${p}/energy`, JSON.stringify(snap.energy));
      await this.transport.publish(`${p}/devices/online`, String(snap.devicesOnline));

      // MQTT Discovery de HA (US-213): configs retained + estado en sus topics, con
      // limpieza de los retenidos que ya no aplican (dispositivo quitado o discovery
      // desactivado). Se publica además de los topics legados de US-174.
      if (c.discovery) {
        const configs = buildDiscoveryConfigs(snap, p, this.controlFlags(c));
        // Solo lo que cambió: una config idéntica ya está retenida en el broker.
        for (const m of configs) {
          if (this.lastConfigs.get(m.topic) === m.payload) continue;
          await this.transport.publish(m.topic, m.payload, { retain: true });
        }
        // El ESTADO sí va siempre: es lo que se mueve.
        for (const m of buildStateMessages(snap, p)) {
          await this.transport.publish(m.topic, m.payload, { retain: !!m.retain });
        }
        const current = new Map(configs.map((m) => [m.topic, m.payload]));
        for (const topic of this.lastConfigs.keys()) {
          if (!current.has(topic)) {
            const rm = removalMessage(topic);
            await this.transport.publish(rm.topic, rm.payload, { retain: true });
          }
        }
        this.lastConfigs = current;
      } else if (this.lastConfigs.size > 0) {
        // Discovery recién desactivado: borra todas las configs retenidas.
        for (const topic of this.lastConfigs.keys()) {
          const rm = removalMessage(topic);
          await this.transport.publish(rm.topic, rm.payload, { retain: true });
        }
        this.lastConfigs = new Map();
      }
      this.connected = true;
      this.lastPublishAt = this.now();
      this.lastError = null;
    } catch (err) {
      this.connected = false;
      this.lastError = err instanceof Error ? err.message : 'Error al publicar';
      this.deps.onError?.(this.lastError);
    }
  }

  /** Superficies de control entrante activas. Cada una es un toggle propio. */
  private controlFlags(c: StoredConfig): ControlFlags {
    return { iot: c.control && !!this.deps.onCommand, pause: c.pauseControl && !!this.deps.onPause };
  }

  /**
   * Cierra la conexión y detiene el barrido (US-201: managers persistentes).
   *
   * Se **despide** publicando `offline` retenido antes de desconectar: el LWT solo
   * lo publica el broker ante una caída **abrupta**, así que un apagado ordenado
   * dejaría a HA viendo la casa disponible hasta el siguiente arranque (US-236).
   */
  async stop(): Promise<void> {
    this.loop?.stop();
    this.loop = null;
    if (this.transport) {
      try {
        const { topicPrefix } = await this.readStored();
        const bye = offlineMessage(topicPrefix);
        await this.transport.publish(bye.topic, bye.payload, { retain: true });
      } catch {
        // Un adiós fallido no debe impedir cerrar: para eso está el LWT.
      }
      await this.transport.dispose?.().catch(() => undefined);
      this.transport = null;
    }
    this.connected = false;
  }

  private safeDecrypt(token: string): string | undefined {
    try {
      return this.deps.secretbox.decrypt(token);
    } catch {
      return undefined;
    }
  }
}

function clampInterval(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return DEFAULTS.intervalSec;
  return Math.min(MAX_INTERVAL_SEC, Math.max(MIN_INTERVAL_SEC, Math.round(n)));
}

/** Sanea un id para un nivel de topic (sin `/`, `+`, `#`, espacios). */
function encodeTopic(id: string): string {
  return id.replace(/[/+#\s]/g, '_');
}
