/**
 * Transporte UDP multicast del auto-descubrimiento (US-175) — **inyectable**
 * (patrón `UdpTransport` de govee/kasa): la lógica de sondeo y huellas se
 * testea con un fake; el socket real solo se verifica en despliegue (US-86).
 *
 * Garantía de no-egress: los únicos destinos permitidos son los dos grupos
 * multicast estándar de la LAN (mDNS y SSDP) con TTL 1 — un datagrama
 * multicast con TTL 1 no cruza el router, así que **nunca sale nada fuera**.
 */

export const MDNS_GROUP = '224.0.0.251';
export const MDNS_PORT = 5353;
export { SSDP_GROUP, SSDP_PORT } from './ssdp.js';

const ALLOWED_TARGETS = new Set([`${MDNS_GROUP}:${MDNS_PORT}`, '239.255.255.250:1900']);

/** Respuesta cruda de un sondeo. */
export interface DiscoveryProbeResponse {
  data: Buffer;
  /** IP de origen del datagrama. */
  from: string;
}

/** Contrato del transporte: envía `payload` al grupo y recoge respuestas. */
export interface DiscoveryTransport {
  probe(
    group: string,
    port: number,
    payload: Buffer,
    waitMs: number,
  ): Promise<DiscoveryProbeResponse[]>;
}

/** Transporte real con `node:dgram` (import perezoso, como kasa/govee). */
export class DgramDiscoveryTransport implements DiscoveryTransport {
  async probe(
    group: string,
    port: number,
    payload: Buffer,
    waitMs: number,
  ): Promise<DiscoveryProbeResponse[]> {
    if (!ALLOWED_TARGETS.has(`${group}:${port}`)) {
      throw new Error(`destino de sondeo no permitido: ${group}:${port}`);
    }
    const dgram = await import('node:dgram');
    return new Promise((resolve) => {
      const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      const out: DiscoveryProbeResponse[] = [];
      const finish = () => {
        try {
          socket.close();
        } catch {
          // ya cerrado
        }
        resolve(out);
      };
      socket.on('message', (data, rinfo) => {
        out.push({ data, from: rinfo.address });
      });
      socket.on('error', finish);
      socket.bind(() => {
        try {
          socket.setMulticastTTL(1); // solo LAN: no cruza el router
        } catch {
          // no soportado en la plataforma: el grupo multicast sigue siendo local
        }
        socket.send(payload, port, group);
      });
      const timer = setTimeout(finish, waitMs);
      timer.unref();
    });
  }
}
