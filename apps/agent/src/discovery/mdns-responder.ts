/**
 * Respondedor mDNS del propio nombre `<equipo>.local` (US-283). Parte pura
 * (decidir y codificar) más una clase con el socket inyectable. No sondea ni
 * anuncia: solo contesta cuando alguien pregunta por nuestro nombre, y solo con
 * IPs privadas (nunca públicas ni link-local). Cualquiera en la LAN puede mandar
 * basura: el parser descarta sin lanzar y el limitador no crece sin tope.
 */
import type { MdnsResponderStatus } from '@krakenos/types';
import type { NetworkInterfaceInfo } from 'node:os';
import { encodeName, readName } from './dns.js';
import { MDNS_GROUP, MDNS_PORT } from './transport.js';

const TYPE_A = 1;
const TYPE_AAAA = 28;
const TYPE_ANY = 255;
const TTL = 120;
const LEGACY_TTL = 10; // RFC 6762 §6.7
const MAX_QUESTIONS = 16;
const MAX_DATAGRAM = 9000;
const RATE_WINDOW_MS = 1000;
const MAX_RATE_KEYS = 256;

type Ips = { v4: string[]; v6: string[] };

/** Socket mínimo que necesita el respondedor (el real es de la Task 2). */
export interface ResponderSocket {
  start(
    onMessage: (msg: Buffer, from: { address: string; port: number }) => void,
    /** Error del socket ya abierto (red caída, etc.): el respondedor deja de declararse activo. */
    onError?: (err: Error) => void,
  ): Promise<void>;
  /** `via`: IPv4 de la interfaz por la que sale un envío al grupo multicast. */
  send(data: Buffer, address: string, port: number, via?: string): void;
  /** Vuelve a unirse al grupo por las interfaces actuales (la red cambió). */
  refresh?(): void;
  close(): Promise<void>;
}

function privateV4(ip: string): boolean {
  const p = ip.split('.').map(Number);
  const [a, b] = [p[0] ?? -1, p[1] ?? -1];
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function v4Int(ip: string): number {
  return ip.split('.').reduce((n, o) => n * 256 + Number(o), 0);
}

/** ¿La subred de la interfaz contiene `ip`? (v4 por máscara, v6 por prefijo del `cidr`). */
function subnetContains(i: NetworkInterfaceInfo, ip: string): boolean {
  if (i.family === 'IPv4') {
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return false;
    const m = v4Int(i.netmask);
    return ((v4Int(i.address) ^ v4Int(ip)) & m) >>> 0 === 0;
  }
  const prefix = Number(i.cidr?.split('/')[1]);
  const a = v6Bytes(i.address);
  const b = v6Bytes(ip.split('%')[0] ?? '');
  if (!a || !b || !Number.isInteger(prefix)) return false;
  for (let bit = 0; bit < prefix; bit += 8) {
    const mask = prefix - bit >= 8 ? 0xff : (0xff << (8 - (prefix - bit))) & 0xff;
    if (((a[bit / 8]! ^ b[bit / 8]!) & mask) !== 0) return false;
  }
  return true;
}

function externalNics(ifaces: NodeJS.Dict<NetworkInterfaceInfo[]>): NetworkInterfaceInfo[] {
  return Object.values(ifaces).flatMap((l) => (l ?? []).filter((i) => !i.internal));
}

/** ¿`from` está en la subred de alguna interfaz (o es link-local v6, que siempre es on-link)? */
export function sourceOnLink(ifaces: NodeJS.Dict<NetworkInterfaceInfo[]>, from: string): boolean {
  if (/^fe80:/i.test(from)) return true;
  return externalNics(ifaces).some((i) => subnetContains(i, from));
}

/** IPv4 de la interfaz privada cuya subred contiene a `from`; `undefined` si ninguna. */
function viaFor(ifaces: NodeJS.Dict<NetworkInterfaceInfo[]>, from: string): string | undefined {
  return externalNics(ifaces).find(
    (i) => i.family === 'IPv4' && privateV4(i.address) && subnetContains(i, from),
  )?.address;
}

/**
 * Solo IPv4 privadas (RFC 1918) y IPv6 ULA (fc00::/7) de interfaces no internas. Con `from`,
 * solo las de la subred que contiene al preguntón (RFC 6762 §6.2); si ninguna encaja, todas.
 */
export function addressesFromInterfaces(
  ifaces: NodeJS.Dict<NetworkInterfaceInfo[]>,
  from?: string,
): Ips {
  const valid = (i: NetworkInterfaceInfo) =>
    (i.family === 'IPv4' && privateV4(i.address)) ||
    (i.family === 'IPv6' && /^f[cd][0-9a-f]{2}:/i.test(i.address));
  const all = externalNics(ifaces).filter(valid);
  const near = from ? all.filter((i) => subnetContains(i, from)) : [];
  const out: Ips = { v4: [], v6: [] };
  for (const i of near.length > 0 ? near : all) {
    const list = i.family === 'IPv4' ? out.v4 : out.v6;
    if (!list.includes(i.address)) list.push(i.address);
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

function record(name: Buffer, type: number, rdata: Buffer, legacy: boolean): Buffer {
  const fixed = Buffer.alloc(10);
  fixed.writeUInt16BE(type, 0);
  fixed.writeUInt16BE(legacy ? 1 : 0x8001, 2); // IN (+ cache-flush, salvo unicast legada §6.7)
  fixed.writeUInt32BE(legacy ? LEGACY_TTL : TTL, 4);
  fixed.writeUInt16BE(rdata.length, 8);
  return Buffer.concat([name, fixed, rdata]);
}

/** Decide si contestar y cómo; `unicast` si alguna pregunta pidió QU. Nunca lanza. */
function decide(
  query: Buffer,
  nombre: string | string[],
  ipsOf: Ips | (() => Ips),
  legacy: boolean,
): { packet: Buffer; unicast: boolean; qkey: string } | null {
  try {
    if (query.length < 12 || query.length > MAX_DATAGRAM) return null;
    if ((query.readUInt16BE(2) & 0xf800) !== 0) return null; // solo QUERY (QR=0, opcode 0)
    const qd = query.readUInt16BE(4);
    if (qd === 0 || qd > MAX_QUESTIONS) return null;
    const mine = new Set(
      (Array.isArray(nombre) ? nombre : [nombre]).map((n) => `${n}.local`.toLowerCase()),
    );
    let ips: Ips | null = null; // perezoso: solo si preguntan por nosotros
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
      ips ??= typeof ipsOf === 'function' ? ipsOf() : ipsOf;
      const enc = encodeName(key);
      if (type === TYPE_A || type === TYPE_ANY) {
        if (!seen.has(`${key}/a`)) {
          seen.add(`${key}/a`);
          for (const ip of ips.v4)
            answers.push(record(enc, TYPE_A, Buffer.from(ip.split('.').map(Number)), legacy));
        }
      }
      if (type === TYPE_AAAA || type === TYPE_ANY) {
        if (!seen.has(`${key}/aaaa`)) {
          seen.add(`${key}/aaaa`);
          for (const ip of ips.v6) {
            const b = v6Bytes(ip);
            if (b) answers.push(record(enc, TYPE_AAAA, b, legacy));
          }
        }
      }
      if (qclass & 0x8000) unicast = true;
    }
    if (answers.length === 0) return null;
    const qkey = [...seen].sort().join(',');
    const header = Buffer.alloc(12);
    header.writeUInt16BE(0x8400, 2); // QR + AA
    header.writeUInt16BE(answers.length, 6);
    if (legacy) {
      // §6.7: se copia el ID y se repite la sección de preguntas.
      header.writeUInt16BE(query.readUInt16BE(0), 0);
      header.writeUInt16BE(qd, 4);
      return {
        packet: Buffer.concat([header, query.subarray(12, pos), ...answers]),
        unicast: true,
        qkey,
      };
    }
    return { packet: Buffer.concat([header, ...answers]), unicast, qkey };
  } catch {
    return null; // paquete malformado o truncado: se descarta
  }
}

/** Respuesta A/AAAA a una pregunta por nuestro nombre, o `null` si no toca contestar. */
export function answerFor(
  query: Buffer,
  nombre: string | string[],
  ips: Ips | (() => Ips),
  opts: { legacy?: boolean } = {},
): Buffer | null {
  return decide(query, nombre, ips, opts.legacy ?? false)?.packet ?? null;
}

export interface MdnsResponderDeps {
  socket: ResponderSocket;
  /** Nombre corto ya saneado (como el de la CA local) o varios. */
  nombre: string | string[];
  interfaces: () => NodeJS.Dict<NetworkInterfaceInfo[]>;
  now: () => number;
  log: { warn(msg: string): void };
}

/** Causa estable del fallo de `bind` (la UI elige el texto con ella). */
export type MdnsUnavailableCode = NonNullable<MdnsResponderStatus['code']>;

export class MdnsResponder {
  private readonly lastSent = new Map<string, number>();
  private lastWarned: string | null = null;
  private unavailable: { unavailable: string; code: MdnsUnavailableCode } | null = null;

  constructor(private readonly deps: MdnsResponderDeps) {}

  async start(): Promise<'running' | { unavailable: string; code: MdnsUnavailableCode }> {
    if (this.unavailable !== null) return this.unavailable;
    try {
      await this.deps.socket.start(
        (msg, from) => this.onMessage(msg, from),
        (err) => this.fail(err),
      );
      this.lastWarned = null;
      return 'running';
    } catch (err) {
      return this.fail(err);
    }
  }

  private fail(err: unknown): { unavailable: string; code: MdnsUnavailableCode } {
    const nodeCode = (err as { code?: unknown } | null)?.code;
    this.unavailable = {
      unavailable: err instanceof Error ? err.message : String(err),
      code: nodeCode === 'EADDRINUSE' || nodeCode === 'EACCES' ? nodeCode : 'other',
    };
    // Un reintento que falla igual no vuelve a avisar: el registro no se llena cada minuto.
    if (this.lastWarned !== this.unavailable.unavailable) {
      this.lastWarned = this.unavailable.unavailable;
      this.deps.log.warn(`mDNS: no se pudo abrir el puerto ${MDNS_PORT} (${this.lastWarned})`);
    }
    return this.unavailable;
  }

  /** Estado vivo: `running` salvo que el arranque o el socket hayan fallado. */
  current(): 'running' | { unavailable: string; code: MdnsUnavailableCode } {
    return this.unavailable ?? 'running';
  }

  /** Cierra lo que quedara abierto y vuelve a intentar el arranque. */
  async restart(): ReturnType<MdnsResponder['start']> {
    await this.deps.socket.close();
    this.unavailable = null;
    return this.start();
  }

  refresh(): void {
    this.deps.socket.refresh?.();
  }

  async stop(): Promise<void> {
    await this.deps.socket.close();
  }

  private onMessage(msg: Buffer, from: { address: string; port: number }): void {
    try {
      let ifaces: NodeJS.Dict<NetworkInterfaceInfo[]> | null = null;
      const nics = () => (ifaces ??= this.deps.interfaces());
      // Puerto de origen distinto de 5353 = resolvedor «legacy» (§6.7): se le contesta directo.
      const legacy = from.port !== MDNS_PORT;
      const d = decide(
        msg,
        this.deps.nombre,
        () => addressesFromInterfaces(nics(), from.address),
        legacy,
      );
      if (!d) return;
      // §11: un origen fuera de nuestras subredes se ignora antes de tocar el limitador (ni
      // reflejamos tráfico hacia fuera ni la tabla crece con orígenes falsificados).
      if (!sourceOnLink(nics(), from.address)) return;
      const dest = d.unicast ? from : { address: MDNS_GROUP, port: MDNS_PORT };
      if (!this.allow(`${dest.address}:${dest.port}/${d.qkey}`)) return;
      // Multicast: por la NIC de la subred de quien pregunta (con vEthernet/WSL el SO elegiría mal).
      const via = d.unicast ? undefined : viaFor(nics(), from.address);
      this.deps.socket.send(d.packet, dest.address, dest.port, via);
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
