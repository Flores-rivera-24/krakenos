/**
 * Transporte MQTT para la integración IoT. El manager no conoce mqtt.js: opera
 * contra esta interfaz, lo que permite testear el contrato con un transporte
 * falso (sin un broker ni zigbee2mqtt). La implementación real (`MqttClientTransport`)
 * carga `mqtt` de forma perezosa, solo necesaria en un despliegue real.
 */

/** Maneja un mensaje recibido en un topic suscrito. */
export type MqttMessageHandler = (topic: string, payload: string) => void;

export interface MqttTransport {
  /** Suscribe a un filtro de topic (admite `+`/`#`) y registra el handler. */
  subscribe(filter: string, handler: MqttMessageHandler): Promise<void>;
  /** Publica un payload (string) en un topic. */
  publish(topic: string, payload: string): Promise<void>;
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

export interface MqttClientOptions {
  /** URL del broker, p. ej. `mqtt://localhost:1883`. */
  url: string;
  username?: string;
  password?: string;
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
    publish: (topic: string, payload: string) => void;
    end: () => void;
  }> {
    if (!this.client) {
      const moduleName = 'mqtt';
      const mqtt = (await import(moduleName).catch(() => {
        throw new Error(
          'La integración Zigbee requiere el paquete "mqtt". Instálalo en el servidor (pnpm add mqtt).',
        );
      })) as { connect: (url: string, opts: Record<string, unknown>) => unknown };
      const client = mqtt.connect(this.opts.url, {
        username: this.opts.username,
        password: this.opts.password,
      }) as {
        on: (ev: string, cb: (topic: string, payload: Uint8Array) => void) => void;
        subscribe: (filter: string) => void;
        publish: (topic: string, payload: string) => void;
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
      publish: (topic: string, payload: string) => void;
      end: () => void;
    };
  }

  async subscribe(filter: string, handler: MqttMessageHandler): Promise<void> {
    const client = await this.connect();
    this.subscriptions.push({ filter, handler });
    client.subscribe(filter);
  }

  async publish(topic: string, payload: string): Promise<void> {
    const client = await this.connect();
    client.publish(topic, payload);
  }

  async dispose(): Promise<void> {
    if (this.client) {
      (this.client as { end: () => void }).end();
      this.client = null;
    }
  }
}
