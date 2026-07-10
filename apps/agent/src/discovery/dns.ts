/**
 * Codificador/parser **mínimo y puro** de mDNS (DNS sobre multicast, RFC 6762)
 * para el auto-descubrimiento (US-175). No es un cliente DNS general: codifica
 * consultas PTR con el bit QU (respuesta unicast) y extrae de las respuestas
 * solo lo que necesitan las huellas (PTR/SRV/TXT/A). Un datagrama malformado
 * nunca lanza: se devuelve vacío (en la red doméstica hay de todo).
 */

const TYPE_A = 1;
const TYPE_PTR = 12;
const TYPE_TXT = 16;
const TYPE_SRV = 33;

/** Instancia de servicio anunciada en una respuesta mDNS. */
export interface MdnsServiceInstance {
  /** Servicio consultado, p. ej. `_hue._tcp.local`. */
  service: string;
  /** Nombre completo de la instancia, p. ej. `Hue Bridge._hue._tcp.local`. */
  name: string;
  /** IPv4 anunciada (registro A del host), o `null` si no vino en el paquete. */
  ip: string | null;
  port: number | null;
  txt: Record<string, string>;
}

function encodeName(name: string): Buffer {
  const parts = name.split('.').filter((p) => p !== '');
  const chunks: Buffer[] = [];
  for (const part of parts) {
    const label = Buffer.from(part, 'ascii');
    chunks.push(Buffer.from([label.length]), label);
  }
  chunks.push(Buffer.from([0]));
  return Buffer.concat(chunks);
}

/**
 * Consulta mDNS con una pregunta PTR por servicio. QCLASS lleva el bit QU
 * (0x8000): pedimos respuesta **unicast** hacia nuestro socket efímero, que no
 * está suscrito al grupo multicast.
 */
export function encodeMdnsQuery(services: string[]): Buffer {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(services.length, 4); // QDCOUNT
  const questions = services.map((service) => {
    const q = Buffer.alloc(4);
    q.writeUInt16BE(TYPE_PTR, 0);
    q.writeUInt16BE(0x8001, 2); // IN + QU
    return Buffer.concat([encodeName(service), q]);
  });
  return Buffer.concat([header, ...questions]);
}

/** Lee un nombre DNS (con compresión) y devuelve `[nombre, offsetSiguiente]`. */
function readName(buf: Buffer, offset: number): [string, number] {
  const labels: string[] = [];
  let pos = offset;
  let next = -1; // offset tras el primer puntero (donde sigue el registro)
  let jumps = 0;
  for (;;) {
    if (pos >= buf.length) throw new Error('nombre truncado');
    const len = buf[pos]!;
    if (len === 0) {
      pos += 1;
      break;
    }
    if ((len & 0xc0) === 0xc0) {
      if (pos + 1 >= buf.length) throw new Error('puntero truncado');
      if (next === -1) next = pos + 2;
      pos = ((len & 0x3f) << 8) | buf[pos + 1]!;
      if (++jumps > 32) throw new Error('bucle de punteros');
      continue;
    }
    if (pos + 1 + len > buf.length) throw new Error('etiqueta truncada');
    labels.push(buf.subarray(pos + 1, pos + 1 + len).toString('utf8'));
    pos += 1 + len;
  }
  return [labels.join('.'), next === -1 ? pos : next];
}

function parseTxt(rdata: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  let pos = 0;
  while (pos < rdata.length) {
    const len = rdata[pos]!;
    const entry = rdata.subarray(pos + 1, pos + 1 + len).toString('utf8');
    pos += 1 + len;
    const eq = entry.indexOf('=');
    if (eq > 0) out[entry.slice(0, eq).toLowerCase()] = entry.slice(eq + 1);
  }
  return out;
}

/**
 * Extrae las instancias de servicio de una respuesta mDNS: cruza los PTR
 * (servicio → instancia) con SRV (instancia → host/puerto), TXT y A (host →
 * IPv4) del mismo paquete (los respondedores mDNS los empaquetan juntos).
 */
export function parseMdnsResponse(buf: Buffer): MdnsServiceInstance[] {
  try {
    if (buf.length < 12) return [];
    const counts = {
      qd: buf.readUInt16BE(4),
      an: buf.readUInt16BE(6),
      ns: buf.readUInt16BE(8),
      ar: buf.readUInt16BE(10),
    };
    let pos = 12;
    for (let i = 0; i < counts.qd; i++) {
      const [, next] = readName(buf, pos);
      pos = next + 4;
    }

    const ptr = new Map<string, string[]>(); // servicio → instancias
    const srv = new Map<string, { port: number; target: string }>();
    const txt = new Map<string, Record<string, string>>();
    const a = new Map<string, string>(); // host → IPv4

    const total = counts.an + counts.ns + counts.ar;
    for (let i = 0; i < total && pos < buf.length; i++) {
      const [name, afterName] = readName(buf, pos);
      if (afterName + 10 > buf.length) break;
      const type = buf.readUInt16BE(afterName);
      const rdlength = buf.readUInt16BE(afterName + 8);
      const rdataStart = afterName + 10;
      if (rdataStart + rdlength > buf.length) break;
      const rdata = buf.subarray(rdataStart, rdataStart + rdlength);

      if (type === TYPE_PTR) {
        const [target] = readName(buf, rdataStart);
        const list = ptr.get(name.toLowerCase()) ?? [];
        list.push(target);
        ptr.set(name.toLowerCase(), list);
      } else if (type === TYPE_SRV && rdlength >= 6) {
        const port = rdata.readUInt16BE(4);
        const [target] = readName(buf, rdataStart + 6);
        srv.set(name.toLowerCase(), { port, target: target.toLowerCase() });
      } else if (type === TYPE_TXT) {
        txt.set(name.toLowerCase(), parseTxt(rdata));
      } else if (type === TYPE_A && rdlength === 4) {
        a.set(name.toLowerCase(), [rdata[0], rdata[1], rdata[2], rdata[3]].join('.'));
      }
      pos = rdataStart + rdlength;
    }

    const out: MdnsServiceInstance[] = [];
    for (const [service, instances] of ptr) {
      for (const instance of instances) {
        const record = srv.get(instance.toLowerCase());
        out.push({
          service,
          name: instance,
          ip: record ? (a.get(record.target) ?? null) : (a.values().next().value ?? null),
          port: record?.port ?? null,
          txt: txt.get(instance.toLowerCase()) ?? {},
        });
      }
    }
    return out;
  } catch {
    return []; // datagrama malformado: se ignora
  }
}
