/**
 * Transporte MQTT para la integración IoT. El manager no conoce mqtt.js: opera
 * contra esta interfaz, lo que permite testear el contrato con un transporte
 * falso (sin un broker ni zigbee2mqtt). La implementación real (`MqttClientTransport`)
 * carga `mqtt` de forma perezosa, solo necesaria en un despliegue real.
 */

/** Maneja un mensaje recibido en un topic suscrito. */
export type MqttMessageHandler = (topic: string, payload: string) => void;

/** Opciones de publicación. `retain` deja el mensaje en el broker (HA Discovery). */
export interface MqttPublishOptions {
  retain?: boolean;
}

export interface MqttTransport {
  /** Suscribe a un filtro de topic (admite `+`/`#`) y registra el handler. */
  subscribe(filter: string, handler: MqttMessageHandler): Promise<void>;
  /** Publica un payload (string) en un topic; `retain` para dejarlo retenido. */
  publish(topic: string, payload: string, opts?: MqttPublishOptions): Promise<void>;
  /** Cierra la conexión subyacente. */
  dispose?(): Promise<void>;
}

/**
 * Comprueba si un `topic` concreto encaja con un `filter` MQTT (`+` = un nivel,
 * `#` = resto). Función pura, compartida por el transporte real y los tests.
 */
export function topicMatches(filter: string, topic: string): boolean {
  const f = filter.split('/');
  const t = topic.split('/');
  for (let i = 0; i < f.length; i++) {
    if (f[i] === '#') return true;
    if (f[i] === '+') {
      if (t[i] === undefined) return false;
      continue;
    }
    if (f[i] !== t[i]) return false;
  }
  return f.length === t.length;
}

/**
 * *Last Will and Testament*: lo que el **broker** publica en nuestro nombre si la
 * conexión se corta sin despedirse (agente caído, cable, OOM). Sin esto, un cliente
 * como Home Assistant sigue viendo el último estado retenido —«online»— para
 * siempre (US-236).
 */
export interface MqttWill {
  topic: string;
  payload: string;
  retain?: boolean;
}

export interface MqttClientOptions {
  /** URL del broker, p. ej. `mqtt://localhost:1883`. */
  url: string;
  username?: string;
  password?: string;
  /** Testamento; lo publica el broker si perdemos la conexión de forma abrupta. */
  will?: MqttWill;
}

interface Subscription {
  filter: string;
  handler: MqttMessageHandler;
}

/**
 * Transporte MQTT real sobre `mqtt`. La dependencia se carga con import dinámico
 * (especificador no-literal) para no exigirla en `install`/tests/typecheck: solo
 * se instala en el servidor (`pnpm add mqtt`). No se cubre con unit tests
 * (requiere broker); la lógica testeable vive en los parsers puros y en el
 * `ZigbeeIotManager` con un transporte falso.
 */
export class MqttClientTransport implements MqttTransport {
  private client: unknown = null;
  private readonly subscriptions: Subscription[] = [];

  constructor(private readonly opts: MqttClientOptions) {}

  private async connect(): Promise<{
    subscribe: (filter: string) => void;
    publish: (topic: string, payload: string, opts?: { retain?: boolean }) => void;
    end: () => void;
  }> {
    if (!this.client) {
      const moduleName = 'mqtt';
      const mqtt = (await import(moduleName).catch(() => {
        // El mensaje nombraba a Zigbee, pero este transporte lo comparten ya tres
        // integraciones (zigbee2mqtt, Meross y la ingesta genérica de US-248):
        // decirle a quien configura MQTT Discovery que «la integración Zigbee»
        // necesita algo lo manda a buscar donde no es.
        throw new Error(
          'Esta integración requiere el paquete "mqtt". Instálalo en el servidor (pnpm add mqtt).',
        );
      })) as { connect: (url: string, opts: Record<string, unknown>) => unknown };
      const client = mqtt.connect(this.opts.url, {
        username: this.opts.username,
        password: this.opts.password,
        // El testamento se declara en el CONNECT: no se puede añadir después.
        ...(this.opts.will
          ? {
              will: {
                topic: this.opts.will.topic,
                payload: this.opts.will.payload,
                retain: this.opts.will.retain === true,
                qos: 0,
              },
            }
          : {}),
      }) as {
        on: (ev: string, cb: (topic: string, payload: Uint8Array) => void) => void;
        subscribe: (filter: string) => void;
        publish: (topic: string, payload: string, opts?: { retain?: boolean }) => void;
        end: () => void;
      };
      client.on('message', (topic, payload) => {
        const text = Buffer.from(payload).toString('utf8');
        for (const sub of this.subscriptions) {
          if (topicMatches(sub.filter, topic)) sub.handler(topic, text);
        }
      });
      this.client = client;
    }
    return this.client as {
      subscribe: (filter: string) => void;
      publish: (topic: string, payload: string, opts?: { retain?: boolean }) => void;
      end: () => void;
    };
  }

  async subscribe(filter: string, handler: MqttMessageHandler): Promise<void> {
    const client = await this.connect();
    this.subscriptions.push({ filter, handler });
    client.subscribe(filter);
  }

  async publish(topic: string, payload: string, opts?: { retain?: boolean }): Promise<void> {
    const client = await this.connect();
    client.publish(topic, payload, opts?.retain ? { retain: true } : undefined);
  }

  async dispose(): Promise<void> {
    if (this.client) {
      (this.client as { end: () => void }).end();
      this.client = null;
    }
  }
}
