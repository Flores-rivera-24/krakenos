import { createSocket } from 'node:dgram';

/**
 * Transporte UDP para la **API LAN de Govee**. El manager no conoce `dgram`:
 * opera contra esta interfaz, lo que permite testear el contrato con un
 * transporte falso (sin dispositivos ni red). La implementación real usa
 * `node:dgram` (incluido en Node, sin dependencia npm).
 */

/** Handler de un datagrama recibido (payload de texto + IP de origen). */
export type UdpMessageHandler = (payload: string, fromIp: string) => void;

export interface UdpTransport {
  /** Envía un datagrama unicast a `ip:port`. */
  send(ip: string, port: number, payload: string): Promise<void>;
  /** Envía un datagrama multicast a `group:port` (discovery). */
  sendMulticast(group: string, port: number, payload: string): Promise<void>;
  /** Registra un handler para los datagramas entrantes. */
  onMessage(handler: UdpMessageHandler): void;
  dispose?(): Promise<void>;
}

export interface DgramUdpOptions {
  /** Puerto donde Govee responde (discovery/estado); por defecto 4002. */
  listenPort?: number;
}

/**
 * Transporte UDP real sobre `node:dgram`. Vincula un socket al puerto de
 * recepción (4002) para escuchar las respuestas de discovery/estado de Govee.
 * No se cubre con unit tests (requiere red); la lógica testeable vive en los
 * builders/parsers puros y en `GoveeIotManager` con un transporte falso.
 */
export class DgramUdpTransport implements UdpTransport {
  private socket: ReturnType<typeof createSocket> | null = null;
  private ready: Promise<void> | null = null;
  private readonly handlers: UdpMessageHandler[] = [];
  private readonly listenPort: number;

  constructor(opts: DgramUdpOptions = {}) {
    this.listenPort = opts.listenPort ?? 4002;
  }

  private ensure(): Promise<void> {
    if (!this.ready) {
      this.ready = new Promise<void>((resolve, reject) => {
        const socket = createSocket({ type: 'udp4', reuseAddr: true });
        socket.on('message', (buf, rinfo) => {
          const text = buf.toString('utf8');
          for (const h of this.handlers) h(text, rinfo.address);
        });
        socket.on('error', reject);
        socket.bind(this.listenPort, () => {
          socket.setBroadcast(true);
          resolve();
        });
        this.socket = socket;
      });
    }
    return this.ready;
  }

  async send(ip: string, port: number, payload: string): Promise<void> {
    await this.ensure();
    this.socket!.send(payload, port, ip);
  }

  async sendMulticast(group: string, port: number, payload: string): Promise<void> {
    await this.ensure();
    this.socket!.send(payload, port, group);
  }

  onMessage(handler: UdpMessageHandler): void {
    this.handlers.push(handler);
  }

  async dispose(): Promise<void> {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
      this.ready = null;
    }
  }
}
