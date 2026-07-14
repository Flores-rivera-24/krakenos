import type { PrismaClient } from '@prisma/client';
import type {
  MqttPublishConfig,
  MqttPublishStatus,
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

/** Estado que se publica (sin secretos ni PII cruda). */
export interface StateSnapshot {
  iot: { id: string; name: string; on: boolean | null; brightness?: number | null; powerW?: number | null }[];
  energy: { todayKwh: number; todayCost: number; currency: string } | null;
  /** Nº de dispositivos de red en línea (resumen, sin MAC/IP). */
  devicesOnline: number;
}

export type SnapshotSource = () => Promise<StateSnapshot>;
export type MqttTransportFactory = (opts: MqttClientOptions) => MqttTransport;

interface StoredConfig {
  enabled: boolean;
  url: string;
  username: string;
  /** Contraseña cifrada (token `kbx1.*`) o cadena vacía si no hay. */
  passwordEnc: string;
  topicPrefix: string;
  intervalSec: number;
}

const SETTING_KEY = 'interop.mqtt';
const DEFAULTS: StoredConfig = {
  enabled: false,
  url: '',
  username: '',
  passwordEnc: '',
  topicPrefix: 'krakenos',
  intervalSec: 30,
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
}

export class MqttPublisher {
  private readonly transportFactory: MqttTransportFactory;
  private readonly egressPolicy: EgressPolicy;
  private readonly now: () => Date;
  private transport: MqttTransport | null = null;
  private timer: NodeJS.Timeout | null = null;
  private connected = false;
  private lastPublishAt: Date | null = null;
  private lastError: string | null = null;

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
    };
  }

  getStatus(): MqttPublishStatus {
    return {
      enabled: this.timer !== null,
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

    const password = c.passwordEnc ? this.safeDecrypt(c.passwordEnc) : undefined;
    this.transport = this.transportFactory({
      url: c.url,
      username: c.username || undefined,
      password,
    });
    this.lastError = null;

    const tick = () => void this.publishOnce();
    this.timer = setInterval(tick, c.intervalSec * 1000);
    this.timer.unref?.();
    // Primera publicación inmediata.
    tick();
  }

  /** Publica una foto del estado en los topics. No lanza. */
  async publishOnce(): Promise<void> {
    if (!this.transport) return;
    try {
      const snap = await this.deps.snapshot();
      const c = await this.readStored();
      const p = c.topicPrefix;
      await this.transport.publish(`${p}/status`, 'online');
      for (const d of snap.iot) {
        await this.transport.publish(
          `${p}/iot/${encodeTopic(d.id)}`,
          JSON.stringify({ name: d.name, on: d.on, brightness: d.brightness ?? null, powerW: d.powerW ?? null }),
        );
      }
      if (snap.energy) await this.transport.publish(`${p}/energy`, JSON.stringify(snap.energy));
      await this.transport.publish(`${p}/devices/online`, String(snap.devicesOnline));
      this.connected = true;
      this.lastPublishAt = this.now();
      this.lastError = null;
    } catch (err) {
      this.connected = false;
      this.lastError = err instanceof Error ? err.message : 'Error al publicar';
      this.deps.onError?.(this.lastError);
    }
  }

  /** Cierra la conexión y detiene el barrido (US-201: managers persistentes). */
  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.transport) {
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
