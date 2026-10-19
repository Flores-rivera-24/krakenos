import os from 'node:os';

/**
 * Ayuda de arranque (US-105): muestra al primer arranque la URL del asistente de
 * configuración —con el token ya incrustado— y un QR escaneable, para que un
 * usuario no técnico no tenga que rebuscar el token en `journalctl`. No expone nada
 * nuevo: el token ya se imprime en el log (canal out-of-band, US-81).
 */

type Interfaces = ReturnType<typeof os.networkInterfaces>;

/** ¿Es una IPv4 privada de RFC 1918 (10/8, 172.16/12, 192.168/16)? */
export function isPrivateIpv4(ip: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return false;
  const [a, b, c, d] = m.slice(1).map(Number) as [number, number, number, number];
  if (a > 255 || b > 255 || c > 255 || d > 255) return false;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/** Interfaces virtuales de contenedores: su IP privada no es la de la LAN. */
const VIRTUAL_IFACE = /^(docker|br-|veth|virbr|cni|flannel)/;

/**
 * Primera IPv4 **privada** (RFC 1918), o `localhost` si no hay ninguna. Como
 * `crypto/local-ca.ts`: una `100.x` de Tailscale o una IP pública no ganan por ir antes
 * en el orden. `os.networkInterfaces()` no dice cuál interfaz tiene la ruta por
 * defecto, así que la 172.16/12 (la NAT de WSL2, Docker, Hyper-V) solo se usa si no
 * hay ninguna 10.x ni 192.168.x; y se saltan las interfaces virtuales de contenedores.
 */
export function firstLanIpv4(interfaces: Interfaces = os.networkInterfaces()): string {
  const privadas: string[] = [];
  for (const [name, addrs] of Object.entries(interfaces)) {
    if (VIRTUAL_IFACE.test(name)) continue;
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal && isPrivateIpv4(a.address)) privadas.push(a.address);
    }
  }
  return privadas.find((ip) => !ip.startsWith('172.')) ?? privadas[0] ?? 'localhost';
}

/**
 * Origen explícito de la instalación (`WEB_ORIGIN` fijado, p. ej. por `--tls`), o
 * `null`. Un origen de loopback (`http://localhost:5173`, el servidor de vite en dev)
 * no cuenta: no es alcanzable desde el móvil que escanea el QR.
 */
export function explicitOrigin(raw: string | undefined): string | null {
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const host = u.hostname;
  if (host === 'localhost' || host === '[::1]' || /^127\./.test(host)) return null;
  return u.origin;
}

export interface SetupUrlParts {
  scheme: 'http' | 'https';
  host: string;
  port: number;
  token: string;
}

/** Construye la URL del asistente `/setup` con el token en el query string. */
export function buildSetupUrl(parts: SetupUrlParts): string {
  return `${parts.scheme}://${parts.host}:${parts.port}/setup?token=${encodeURIComponent(parts.token)}`;
}

export interface ResolveSetupUrlOptions {
  /** `WEB_ORIGIN` tal como llegó del entorno (sin el valor por defecto de dev). */
  webOrigin: string | undefined;
  https: boolean;
  port: number;
  token: string;
  interfaces?: Interfaces;
}

/** URL del asistente: el origen de la instalación si está fijado; si no, la IP privada de la LAN. */
export function resolveSetupUrl(o: ResolveSetupUrlOptions): string {
  const origin = explicitOrigin(o.webOrigin);
  if (origin) return `${origin}/setup?token=${encodeURIComponent(o.token)}`;
  return buildSetupUrl({
    scheme: o.https ? 'https' : 'http',
    host: firstLanIpv4(o.interfaces),
    port: o.port,
    token: o.token,
  });
}
