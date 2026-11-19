/**
 * Respondedor mDNS del propio nombre `<equipo>.local` (US-283). Parte pura
 * (decidir y codificar) más una clase con el socket inyectable. No sondea ni
 * anuncia: solo contesta cuando alguien pregunta por nuestro nombre, y solo con
 * IPs privadas (nunca públicas ni link-local). Cualquiera en la LAN puede mandar
 * basura: el parser descarta sin lanzar y el limitador no crece sin tope.
 */
import type { NetworkInterfaceInfo } from 'node:os';
import { encodeName, readName } from './dns.js';
import { MDNS_GROUP, MDNS_PORT } from './transport.js';

const TYPE_A = 1;
const TYPE_AAAA = 28;
const TYPE_ANY = 255;
const TTL = 120;
const MAX_QUESTIONS = 16;
const MAX_DATAGRAM = 9000;
const RATE_WINDOW_MS = 1000;
const MAX_RATE_KEYS = 256;

type Ips = { v4: string[]; v6: string[] };

/** Socket mínimo que necesita el respondedor (el real es de la Task 2). */
export interface ResponderSocket {
  start(onMessage: (msg: Buffer, from: { address: string; port: number }) => void): Promise<void>;
  send(data: Buffer, address: string, port: number): void;
  close(): Promise<void>;
}

function privateV4(ip: string): boolean {
  const p = ip.split('.').map(Number);
  const [a, b] = [p[0] ?? -1, p[1] ?? -1];
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/** Solo IPv4 privadas (RFC 1918) y IPv6 ULA (fc00::/7) de interfaces no internas. */
export function addressesFromInterfaces(ifaces: NodeJS.Dict<NetworkInterfaceInfo[]>): Ips {
  const out: Ips = { v4: [], v6: [] };
  for (const list of Object.values(ifaces)) {
    for (const i of list ?? []) {
      if (i.internal) continue;
      if (i.family === 'IPv4' && privateV4(i.address) && !out.v4.includes(i.address))
        out.v4.push(i.address);
      else if (
        i.family === 'IPv6' &&
        /^f[cd][0-9a-f]{2}:/i.test(i.address) &&
        !out.v6.includes(i.address)
      )
        out.v6.push(i.address);
    }
  }
  return out;
}

function v6Bytes(ip: string): Buffer | null {
  const [head = '', tail] = ip.split('::');
  const h = head ? head.split(':') : [];
  const t = tail === undefined ? [] : tail ? tail.split(':') : [];
  const fill = tail === undefined ? 0 : 8 - h.length - t.length;
  if (fill < 0 || (tail === undefined && h.length !== 8)) return null;
  const groups = [...h, ...Array<string>(fill).fill('0'), ...t];
  const b = Buffer.alloc(16);
  groups.forEach((g, n) => b.writeUInt16BE(parseInt(g, 16) & 0xffff, n * 2));
  return b;
}

function record(name: Buffer, type: number, rdata: Buffer): Buffer {
  const fixed = Buffer.alloc(10);
  fixed.writeUInt16BE(type, 0);
  fixed.writeUInt16BE(0x8001, 2); // IN + cache-flush
  fixed.writeUInt32BE(TTL, 4);
  fixed.writeUInt16BE(rdata.length, 8);
  return Buffer.concat([name, fixed, rdata]);
}

/** Decide si contestar y cómo; `unicast` si alguna pregunta pidió QU. Nunca lanza. */
function decide(
  query: Buffer,
  nombre: string | string[],
  ips: Ips,
): { packet: Buffer; unicast: boolean } | null {
  try {
    if (query.length < 12 || query.length > MAX_DATAGRAM) return null;
    if ((query.readUInt16BE(2) & 0xf800) !== 0) return null; // solo QUERY (QR=0, opcode 0)
    const qd = query.readUInt16BE(4);
    if (qd === 0 || qd > MAX_QUESTIONS) return null;
    const mine = new Set(
      (Array.isArray(nombre) ? nombre : [nombre]).map((n) => `${n}.local`.toLowerCase()),
    );
    const answers: Buffer[] = [];
    const seen = new Set<string>();
    let unicast = false;
    let pos = 12;
    for (let i = 0; i < qd; i++) {
      const [name, next] = readName(query, pos);
      if (next + 4 > query.length) return null;
      const type = query.readUInt16BE(next);
      const qclass = query.readUInt16BE(next + 2);
      pos = next + 4;
      const key = name.toLowerCase();
      if (!mine.has(key) || (qclass & 0x7fff) !== 1) continue;
      const enc = encodeName(key);
      if (type === TYPE_A || type === TYPE_ANY) {
        if (!seen.has(`${key}/a`)) {
          seen.add(`${key}/a`);
          for (const ip of ips.v4)
            answers.push(record(enc, TYPE_A, Buffer.from(ip.split('.').map(Number))));
        }
      }
      if (type === TYPE_AAAA || type === TYPE_ANY) {
        if (!seen.has(`${key}/aaaa`)) {
          seen.add(`${key}/aaaa`);
          for (const ip of ips.v6) {
            const b = v6Bytes(ip);
            if (b) answers.push(record(enc, TYPE_AAAA, b));
          }
        }
      }
      if (qclass & 0x8000) unicast = true;
    }
    if (answers.length === 0) return null;
    const header = Buffer.alloc(12);
    header.writeUInt16BE(0x8400, 2); // QR + AA
    header.writeUInt16BE(answers.length, 6);
    return { packet: Buffer.concat([header, ...answers]), unicast };
  } catch {
    return null; // paquete malformado o truncado: se descarta
  }
}

/** Respuesta A/AAAA a una pregunta por nuestro nombre, o `null` si no toca contestar. */
export function answerFor(query: Buffer, nombre: string | string[], ips: Ips): Buffer | null {
  return decide(query, nombre, ips)?.packet ?? null;
}

export interface MdnsResponderDeps {
  socket: ResponderSocket;
  /** Nombre corto ya saneado (como el de la CA local) o varios. */
  nombre: string | string[];
  interfaces: () => NodeJS.Dict<NetworkInterfaceInfo[]>;
  now: () => number;
  log: { warn(msg: string): void };
}

export class MdnsResponder {
  private readonly lastSent = new Map<string, number>();
  private unavailable: string | null = null;

  constructor(private readonly deps: MdnsResponderDeps) {}

  async start(): Promise<'running' | { unavailable: string }> {
    if (this.unavailable !== null) return { unavailable: this.unavailable };
    try {
      await this.deps.socket.start((msg, from) => this.onMessage(msg, from));
      return 'running';
    } catch (err) {
      this.unavailable = err instanceof Error ? err.message : String(err);
      this.deps.log.warn(`mDNS: no se pudo abrir el puerto ${MDNS_PORT} (${this.unavailable})`);
      return { unavailable: this.unavailable };
    }
  }

  async stop(): Promise<void> {
    await this.deps.socket.close();
  }

  private onMessage(msg: Buffer, from: { address: string; port: number }): void {
    try {
      const d = decide(msg, this.deps.nombre, addressesFromInterfaces(this.deps.interfaces()));
      if (!d) return;
      // Puerto de origen distinto de 5353 = resolvedor «legacy»: se le contesta directo.
      const unicast = d.unicast || from.port !== MDNS_PORT;
      const dest = unicast ? from : { address: MDNS_GROUP, port: MDNS_PORT };
      if (!this.allow(`${dest.address}:${dest.port}`)) return;
      this.deps.socket.send(d.packet, dest.address, dest.port);
    } catch (err) {
      this.deps.log.warn(
        `mDNS: datagrama descartado (${err instanceof Error ? err.message : err})`,
      );
    }
  }

  /** Una respuesta por segundo y destino; el mapa tiene tope y se poda por antigüedad. */
  private allow(key: string): boolean {
    const now = this.deps.now();
    if (this.lastSent.size >= MAX_RATE_KEYS) {
      for (const [k, t] of this.lastSent) if (now - t >= RATE_WINDOW_MS) this.lastSent.delete(k);
      if (this.lastSent.size >= MAX_RATE_KEYS) return false;
    }
    const last = this.lastSent.get(key);
    if (last !== undefined && now - last < RATE_WINDOW_MS) return false;
    this.lastSent.set(key, now);
    return true;
  }
}
