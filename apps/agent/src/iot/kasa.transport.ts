import type * as NodeCrypto from 'node:crypto';
import { KASA_SYSINFO, deframeKasaTcp, frameKasaTcp, kasaDecrypt, kasaEncrypt } from './kasa.parsers.js';

/**
 * Transportes para TP-Link Kasa/Tapo. El manager no conoce sockets ni crypto:
 * opera contra estas interfaces, lo que permite testear el contrato con
 * transportes falsos (sin dispositivos ni red). Las implementaciones reales usan
 * `node:net`/`node:dgram`/`node:crypto` (stdlib, sin dependencia npm) con import
 * perezoso y **no** se cubren con unit tests (verificación en despliegue).
 */

/** Dispositivo Kasa descubierto: IP + el `get_sysinfo` crudo. */
export interface KasaDiscovered {
  ip: string;
  sysinfo: unknown;
}

/** Transporte Kasa (Gen1/2): descubrimiento UDP + petición TCP cifrada (XOR). */
export interface KasaTransport {
  /** Descubre dispositivos por broadcast UDP (puerto 9999). */
  discover(timeoutMs?: number): Promise<KasaDiscovered[]>;
  /** Envía un comando JSON a `ip` por TCP (9999) y devuelve la respuesta JSON. */
  send(ip: string, commandJson: string): Promise<unknown>;
  dispose?(): Promise<void>;
}

/** Transporte Tapo (Gen3+): descubrimiento UDP + petición JSON sobre sesión KLAP. */
export interface TapoTransport {
  /** Descubre IPs de dispositivos Tapo (puerto UDP 20002). */
  discover(timeoutMs?: number): Promise<string[]>;
  /** Ejecuta un método (`get_device_info`/`set_device_info`) en `ip` y devuelve el resultado. */
  request(ip: string, method: string, params?: Record<string, unknown>): Promise<unknown>;
  dispose?(): Promise<void>;
}

// ---- Implementación real Kasa (node:net + node:dgram, import perezoso) ----

export interface NetKasaOptions {
  /** Puerto de control Kasa (por defecto 9999). */
  port?: number;
  /** IPs configuradas manualmente (se sondean además del broadcast). */
  configuredIps?: string[];
}

export class NetKasaTransport implements KasaTransport {
  private readonly port: number;
  constructor(private readonly opts: NetKasaOptions = {}) {
    this.port = opts.port ?? 9999;
  }

  async send(ip: string, commandJson: string): Promise<unknown> {
    const net = await import('node:net');
    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      const chunks: Buffer[] = [];
      socket.setTimeout(3000);
      socket.connect(this.port, ip, () => socket.write(frameKasaTcp(commandJson)));
      socket.on('data', (d) => chunks.push(d));
      socket.on('timeout', () => socket.destroy(new Error('Kasa TCP timeout')));
      socket.on('error', reject);
      socket.on('close', () => {
        try {
          resolve(JSON.parse(deframeKasaTcp(Buffer.concat(chunks))));
        } catch (err) {
          reject(err as Error);
        }
      });
    });
  }

  async discover(timeoutMs = 2000): Promise<KasaDiscovered[]> {
    const dgram = await import('node:dgram');
    return new Promise((resolve) => {
      const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      const found = new Map<string, KasaDiscovered>();
      // UDP no lleva cabecera de longitud: cifrado XOR directo.
      const payload = kasaEncrypt(KASA_SYSINFO);
      socket.on('message', (buf, rinfo) => {
        try {
          found.set(rinfo.address, { ip: rinfo.address, sysinfo: JSON.parse(kasaDecrypt(buf)) });
        } catch {
          // datagrama no-Kasa: se ignora
        }
      });
      socket.on('error', () => resolve([...found.values()]));
      socket.bind(() => {
        socket.setBroadcast(true);
        socket.send(payload, this.port, '255.255.255.255');
        for (const ip of this.opts.configuredIps ?? []) socket.send(payload, this.port, ip);
      });
      setTimeout(() => {
        socket.close();
        resolve([...found.values()]);
      }, timeoutMs);
    });
  }
}

// ---- Implementación real Tapo / KLAP (node:http + node:crypto, import perezoso) ----

export interface KlapTapoOptions {
  /** Email de la cuenta Tapo (credencial local KLAP). */
  email: string;
  /** Contraseña de la cuenta Tapo. */
  password: string;
  /** IPs configuradas manualmente (`TAPO_DEVICES`). */
  configuredIps?: string[];
  /** Puerto HTTP del dispositivo (por defecto 80). */
  port?: number;
}

/** Sesión KLAP cacheada por IP (claves + contador de secuencia). */
interface KlapSession {
  cookie: string;
  key: Buffer;
  iv: Buffer;
  sig: Buffer;
  seq: number;
}

/**
 * Transporte Tapo (Gen3+) sobre **KLAP** (handshake de 3 pasos, AES-128-CBC +
 * HMAC/SHA-256). Usa `node:http`/`node:crypto` con import perezoso. No se cubre
 * con unit tests (requiere dispositivo real + handshake criptográfico): su
 * verificación es end-to-end en el despliegue, como los transportes SSH. La
 * lógica testeable (comandos JSON, parseo) vive en `kasa.parsers`.
 */
export class KlapTapoTransport implements TapoTransport {
  private readonly port: number;
  private readonly sessions = new Map<string, KlapSession>();

  constructor(private readonly opts: KlapTapoOptions) {
    this.port = opts.port ?? 80;
  }

  async discover(timeoutMs = 2000): Promise<string[]> {
    const dgram = await import('node:dgram');
    return new Promise((resolve) => {
      const ips = new Set<string>(this.opts.configuredIps ?? []);
      const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      socket.on('message', (_buf, rinfo) => ips.add(rinfo.address));
      socket.on('error', () => resolve([...ips]));
      socket.bind(() => {
        socket.setBroadcast(true);
        // Sonda mínima de descubrimiento Tapo (puerto 20002).
        socket.send(Buffer.from([0x02, 0x00, 0x00, 0x01]), 20002, '255.255.255.255');
      });
      setTimeout(() => {
        socket.close();
        resolve([...ips]);
      }, timeoutMs);
    });
  }

  private async authHash(crypto: typeof NodeCrypto): Promise<Buffer> {
    const sha256 = (b: Buffer) => crypto.createHash('sha256').update(b).digest();
    return sha256(
      Buffer.concat([sha256(Buffer.from(this.opts.email)), sha256(Buffer.from(this.opts.password))]),
    );
  }

  private async handshake(ip: string): Promise<KlapSession> {
    const crypto = await import('node:crypto');
    const sha256 = (b: Buffer) => crypto.createHash('sha256').update(b).digest();
    const auth = await this.authHash(crypto);
    const localSeed = crypto.randomBytes(16);

    const h1 = await this.http(ip, '/app/handshake1', localSeed, null);
    const remoteSeed = h1.body.subarray(0, 16);
    const serverHash = h1.body.subarray(16, 48);
    if (!sha256(Buffer.concat([localSeed, remoteSeed, auth])).equals(serverHash)) {
      throw new Error('KLAP handshake1: credenciales Tapo inválidas');
    }
    const cookie = h1.cookie ?? '';
    const payload2 = sha256(Buffer.concat([remoteSeed, localSeed, auth]));
    await this.http(ip, '/app/handshake2', payload2, cookie);

    const derive = (prefix: string) =>
      sha256(Buffer.concat([Buffer.from(prefix), localSeed, remoteSeed, auth]));
    const ivSeed = derive('iv');
    const session: KlapSession = {
      cookie,
      key: derive('lsk').subarray(0, 16),
      iv: ivSeed.subarray(0, 12),
      sig: derive('ldk').subarray(0, 28),
      seq: ivSeed.readInt32BE(28),
    };
    this.sessions.set(ip, session);
    return session;
  }

  async request(ip: string, method: string, params?: Record<string, unknown>): Promise<unknown> {
    const crypto = await import('node:crypto');
    const session = this.sessions.get(ip) ?? (await this.handshake(ip));
    session.seq += 1;
    const body = JSON.stringify({ method, params, requestTimeMils: 0 });

    const seqBuf = Buffer.alloc(4);
    seqBuf.writeInt32BE(session.seq, 0);
    const ivFull = Buffer.concat([session.iv, seqBuf]);
    const cipher = crypto.createCipheriv('aes-128-cbc', session.key, ivFull);
    const ciphertext = Buffer.concat([cipher.update(Buffer.from(body)), cipher.final()]);
    const signature = crypto
      .createHash('sha256')
      .update(Buffer.concat([session.sig, seqBuf, ciphertext]))
      .digest();
    const res = await this.http(
      ip,
      `/app/request?seq=${session.seq}`,
      Buffer.concat([signature, ciphertext]),
      session.cookie,
    );

    const decipher = crypto.createDecipheriv('aes-128-cbc', session.key, ivFull);
    const plain = Buffer.concat([decipher.update(res.body.subarray(32)), decipher.final()]);
    return JSON.parse(plain.toString('utf8'));
  }

  private async http(
    ip: string,
    path: string,
    body: Buffer,
    cookie: string | null,
  ): Promise<{ status: number; body: Buffer; cookie: string | null }> {
    const http = await import('node:http');
    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = { 'Content-Type': 'application/octet-stream' };
      if (cookie) headers['Cookie'] = cookie;
      const req = http.request(
        { host: ip, port: this.port, path, method: 'POST', headers, timeout: 3000 },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => {
            const setCookie = res.headers['set-cookie']?.[0]?.split(';')[0] ?? null;
            resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks), cookie: setCookie ?? cookie });
          });
        },
      );
      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error('Tapo HTTP timeout')));
      req.end(body);
    });
  }
}
