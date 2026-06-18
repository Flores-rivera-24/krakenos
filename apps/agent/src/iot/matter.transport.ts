/**
 * Transporte WebSocket para python-matter-server. El cliente no conoce `ws`:
 * opera contra esta interfaz, lo que permite testear el contrato con un
 * transporte falso. La implementación real (`WebSocketTransport`) carga `ws`
 * de forma perezosa, solo necesaria en un despliegue real.
 */

export interface WsTransport {
  /** Registra un handler para los mensajes entrantes (texto JSON). */
  onMessage(handler: (data: string) => void): void;
  /** Envía un mensaje (texto JSON). */
  send(data: string): Promise<void>;
  dispose?(): Promise<void>;
}

export interface WebSocketTransportOptions {
  /** URL del WebSocket, p. ej. `ws://localhost:5580/ws`. */
  url: string;
}

/**
 * Transporte WebSocket real sobre `ws`, cargado con import dinámico
 * (especificador no-literal) para no exigirlo en `install`/tests/typecheck. La
 * conexión se abre de forma perezosa en el primer `send`.
 */
export class WebSocketTransport implements WsTransport {
  private socket: unknown = null;
  private ready: Promise<void> | null = null;
  private readonly handlers: ((data: string) => void)[] = [];

  constructor(private readonly opts: WebSocketTransportOptions) {}

  onMessage(handler: (data: string) => void): void {
    this.handlers.push(handler);
  }

  private ensure(): Promise<void> {
    if (!this.ready) {
      this.ready = (async () => {
        const moduleName = 'ws';
        const mod = (await import(moduleName).catch(() => {
          throw new Error(
            'La integración Matter requiere el paquete "ws". Instálalo en el servidor (pnpm add ws).',
          );
        })) as { WebSocket?: unknown; default?: unknown };
        const WebSocketCtor = (mod.WebSocket ?? mod.default) as new (url: string) => {
          on: (ev: string, cb: (arg: unknown) => void) => void;
          send: (data: string) => void;
          close: () => void;
        };
        const socket = new WebSocketCtor(this.opts.url);
        socket.on('message', (data: unknown) => {
          const text = typeof data === 'string' ? data : String(data);
          for (const h of this.handlers) h(text);
        });
        await new Promise<void>((resolve, reject) => {
          socket.on('open', () => resolve());
          socket.on('error', (err: unknown) => reject(err as Error));
        });
        this.socket = socket;
      })();
    }
    return this.ready;
  }

  async send(data: string): Promise<void> {
    await this.ensure();
    (this.socket as { send: (d: string) => void }).send(data);
  }

  async dispose(): Promise<void> {
    if (this.socket) {
      (this.socket as { close: () => void }).close();
      this.socket = null;
      this.ready = null;
    }
  }
}

/**
 * Cliente JSON de python-matter-server sobre un `WsTransport`. Implementa
 * petición/respuesta correlacionando por `message_id`; ignora los mensajes sin
 * id pendiente (info del servidor / eventos). Puro en su lógica de correlación.
 */
export class MatterClient {
  private readonly pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private seq = 0;

  constructor(private readonly transport: WsTransport) {
    transport.onMessage((data) => this.onMessage(data));
  }

  private onMessage(data: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return;
    }
    const id = typeof msg.message_id === 'string' ? msg.message_id : null;
    if (!id || !this.pending.has(id)) return;
    const p = this.pending.get(id)!;
    this.pending.delete(id);
    if (msg.error_code !== undefined || msg.errorCode !== undefined) {
      p.reject(new Error(typeof msg.details === 'string' ? msg.details : 'Error de Matter'));
    } else {
      p.resolve(msg.result);
    }
  }

  /** Envía un comando y resuelve con su `result` cuando llega la respuesta. */
  async request(command: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const message_id = String(++this.seq);
    const promise = new Promise<unknown>((resolve, reject) => {
      this.pending.set(message_id, { resolve, reject });
    });
    await this.transport.send(JSON.stringify({ message_id, command, args }));
    return promise;
  }
}
