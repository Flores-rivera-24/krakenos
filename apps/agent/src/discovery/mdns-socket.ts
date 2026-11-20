/**
 * Socket UDP real del respondedor mDNS (US-283). Único fichero del respondedor que toca
 * `node:dgram`: el resto se prueba con un socket falso. Solo habla con el grupo mDNS (TTL 1)
 * y con quien pregunta; un fallo al abrir 5353 se propaga y el respondedor lo vuelve estado.
 */
import { networkInterfaces } from 'node:os';
import type { Socket } from 'node:dgram';
import type { ResponderSocket } from './mdns-responder.js';
import { MDNS_GROUP, MDNS_PORT } from './transport.js';

/** IPv4 privadas de interfaces externas: por ahí nos unimos al grupo. */
function privateV4Nics(): string[] {
  return Object.values(networkInterfaces())
    .flatMap((l) => l ?? [])
    .filter(
      (i) =>
        !i.internal &&
        i.family === 'IPv4' &&
        /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(i.address),
    )
    .map((i) => i.address);
}

export class DgramResponderSocket implements ResponderSocket {
  private sock: Socket | null = null;

  async start(
    onMessage: (msg: Buffer, from: { address: string; port: number }) => void,
    onError?: (err: Error) => void,
  ): Promise<void> {
    const dgram = await import('node:dgram');
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    try {
      await new Promise<void>((resolve, reject) => {
        sock.once('error', reject);
        sock.bind(MDNS_PORT, () => {
          sock.removeListener('error', reject);
          resolve();
        });
      });
      const nics = privateV4Nics();
      if (this.join(sock, nics) === 0) sock.addMembership(MDNS_GROUP); // lanza si no hay red válida
      sock.setMulticastTTL(1); // el paquete nunca cruza el router
      sock.setTTL(1); // tampoco las respuestas unicast
      // Con una sola red la salida multicast es inequívoca; con varias manda la tabla del SO.
      if (nics.length === 1 && nics[0]) sock.setMulticastInterface(nics[0]);
    } catch (err) {
      try {
        sock.close();
      } catch {
        // ya cerrado
      }
      throw err;
    }
    // Un error tras el bind lo gestiona el respondedor (estado + reintento del servicio).
    sock.on('error', (err) => onError?.(err));
    sock.on('message', (msg, rinfo) =>
      onMessage(msg, { address: rinfo.address, port: rinfo.port }),
    );
    this.sock = sock;
  }

  /** Un join por interfaz: sin dirección, Windows solo une la de la ruta por defecto. */
  private join(sock: Socket, nics: string[]): number {
    let joined = 0;
    for (const ip of nics) {
      try {
        sock.addMembership(MDNS_GROUP, ip);
        joined++;
      } catch {
        // ya unida o sin multicast: se sigue con las demás
      }
    }
    return joined;
  }

  refresh(): void {
    if (this.sock) this.join(this.sock, privateV4Nics());
  }

  send(data: Buffer, address: string, port: number, via?: string): void {
    const sock = this.sock;
    if (!sock) return;
    try {
      // shortcut: setMulticastInterface + send no son atómicos; dos respuestas por NIC distintas
      // en el mismo tick podrían cruzarse. Subir a un socket por NIC si el hardware lo muestra.
      if (via && address === MDNS_GROUP) sock.setMulticastInterface(via);
      sock.send(data, port, address, () => {});
    } catch {
      // interfaz que ya no existe: la respuesta se pierde, el siguiente ciclo reajusta
    }
  }

  close(): Promise<void> {
    const sock = this.sock;
    this.sock = null;
    return new Promise((resolve) => {
      if (!sock) return resolve();
      try {
        sock.close(() => resolve());
      } catch {
        resolve();
      }
    });
  }
}
