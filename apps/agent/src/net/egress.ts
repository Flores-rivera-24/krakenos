/**
 * Filtrado de egress (protección SSRF) para las URLs/hosts que configura el usuario
 * (drivers, integraciones, DNS, cámaras…) y para las peticiones salientes del agente.
 *
 * **Matiz propio de esta app:** KrakenOS gestiona la red local, así que las IPs
 * privadas (10/8, 172.16/12, 192.168/16) y a veces loopback (un Pi-hole en la misma
 * caja) son destinos **legítimos**. No se pueden bloquear sin romper la función
 * principal. Por eso la política por defecto solo bloquea lo que **nunca** es un
 * dispositivo legítimo y sí es un objetivo clásico de SSRF:
 *
 *  - **Metadata de nube**: `169.254.169.254` (IMDS AWS/GCP/Azure/…), `169.254.170.2`
 *    (ECS), `fd00:ec2::254` (IMDSv6). Robar credenciales de instancia es el premio gordo.
 *  - **Link-local**: `169.254.0.0/16` y `fe80::/10` (incluye el IMDS; no son destinos
 *    de gestión).
 *  - **Dirección "este host"/no especificada**: `0.0.0.0`, `::` (pueden enrutar a local).
 *
 * En **modo estricto** (`EGRESS_STRICT`, opt-in para despliegues endurecidos /
 * multi-tenant de Fase 4) se bloquean **además** loopback y todos los rangos privados,
 * de modo que un tenant no pueda alcanzar la red interna del host ni otros servicios.
 */
import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

export interface EgressPolicy {
  /**
   * `true` bloquea además loopback + rangos privados (127/8, ::1, 10/8, 172.16/12,
   * 192.168/16, fc00::/7). Para multi-tenant / despliegues sin dispositivos en LAN.
   */
  blockPrivate: boolean;
}

/** Política por defecto: solo metadata/link-local/no-especificada (LAN-friendly). */
export const DEFAULT_EGRESS_POLICY: EgressPolicy = { blockPrivate: false };

export class EgressBlockedError extends Error {
  readonly code = 'EGRESS_BLOCKED';
  constructor(
    message: string,
    readonly target: string,
  ) {
    super(message);
    this.name = 'EgressBlockedError';
  }
}

/** Octetos de una IPv4 válida, o `null` si no lo es. */
function ipv4Octets(ip: string): [number, number, number, number] | null {
  if (isIP(ip) !== 4) return null;
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return null;
  }
  return parts as [number, number, number, number];
}

/**
 * Normaliza una IPv6 a minúsculas y, si es IPv4-mapeada (`::ffff:a.b.c.d`),
 * devuelve la IPv4 embebida para clasificarla como IPv4 (evita el bypass de
 * envolver una IP interna en notación v6).
 */
function unmapV6(ip: string): string {
  const dotted = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(ip);
  if (dotted) return dotted[1]!;
  const lower = ip.toLowerCase();
  // Node normaliza `::ffff:169.254.169.254` a su forma **hexadecimal**
  // `::ffff:a9fe:a9fe` (p. ej. al atravesar `new URL()`), que la regex de arriba no
  // reconoce: sin desmapearla también, el bypass del IMDS vuelve por la puerta de
  // atrás. Hallado con los tests de US-227.
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (hex) {
    const hi = Number.parseInt(hex[1]!, 16);
    const lo = Number.parseInt(hex[2]!, 16);
    return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
  }
  return lower;
}

/** Categorías relevantes de una IP para la decisión de egress. */
interface IpClass {
  metadata: boolean;
  linkLocal: boolean;
  unspecified: boolean;
  loopback: boolean;
  private: boolean;
}

function classifyIp(rawIp: string): IpClass | null {
  const ip = unmapV6(rawIp);
  const v4 = ipv4Octets(ip);
  if (v4) {
    const [a, b] = v4;
    const is = (w: number, x: number, y: number, z: number) =>
      v4[0] === w && v4[1] === x && v4[2] === y && v4[3] === z;
    return {
      metadata: is(169, 254, 169, 254) || is(169, 254, 170, 2),
      linkLocal: a === 169 && b === 254,
      unspecified: a === 0,
      loopback: a === 127,
      private:
        a === 10 ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168),
    };
  }
  if (isIP(ip) === 6) {
    const lower = ip.toLowerCase();
    const firstHextet = lower.split(':')[0] ?? '';
    // fe80::/10 → primer hextet fe8x..febx.
    const linkLocal = /^fe[89ab][0-9a-f]?$/.test(firstHextet);
    // fc00::/7 (unique local) → fc.. / fd..
    const ula = /^f[cd][0-9a-f]{0,2}$/.test(firstHextet);
    return {
      metadata: lower === 'fd00:ec2::254',
      linkLocal,
      unspecified: lower === '::',
      loopback: lower === '::1',
      private: ula,
    };
  }
  return null;
}

/**
 * Decide si una IP concreta está bloqueada por la política. Devuelve el motivo
 * (para el log/error) o `null` si está permitida.
 */
export function blockedReason(ip: string, policy: EgressPolicy): string | null {
  const c = classifyIp(ip);
  if (!c) return 'dirección IP no reconocida';
  // Siempre bloqueado, en cualquier modo.
  if (c.metadata) return 'endpoint de metadata de nube (169.254.169.254 / IMDS)';
  if (c.linkLocal) return 'dirección link-local (169.254.0.0/16 · fe80::/10)';
  if (c.unspecified) return 'dirección no especificada (0.0.0.0 / ::)';
  // Solo en modo estricto.
  if (policy.blockPrivate && c.loopback) return 'loopback bloqueado (modo estricto)';
  if (policy.blockPrivate && c.private) return 'rango privado bloqueado (modo estricto)';
  return null;
}

/** Quita esquema y puerto de un valor de campo `host`/`ip` para quedarse con el host. */
export function extractHost(value: string): string {
  let s = value.trim();
  // Si trae esquema (http://, mqtt://, ws://…), usa el parser de URL. Para IPv6,
  // `URL.hostname` conserva los corchetes (`[fe80::1]`); se quitan para dejar el
  // host desnudo que entiende `isIP`.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    try {
      return new URL(s).hostname.replace(/^\[|\]$/g, '');
    } catch {
      return s;
    }
  }
  // `[::1]:8080` → ::1
  const bracket = /^\[([^\]]+)\]/.exec(s);
  if (bracket) return bracket[1]!;
  // `host:puerto` (una sola `:` → no es IPv6 sin corchetes) → host.
  if ((s.match(/:/g)?.length ?? 0) === 1) s = s.split(':')[0]!;
  return s;
}

/**
 * Resuelve un host (literal IP o nombre DNS) y **lanza `EgressBlockedError` si
 * CUALQUIERA de sus IPs** está bloqueada por la política. Un literal IP se
 * comprueba directo (sin DNS). Un fallo de DNS se propaga como error genérico
 * (el llamante decide si tratarlo como bloqueo o como "host inalcanzable").
 */
export async function assertHostAllowed(
  host: string,
  policy: EgressPolicy = DEFAULT_EGRESS_POLICY,
  opts: { allowUnresolvable?: boolean } = {},
): Promise<void> {
  const trimmed = host.trim();
  if (!trimmed) throw new EgressBlockedError('host vacío', host);
  // `new URL(...).hostname` devuelve las IPv6 **entre corchetes** (`[::1]`,
  // `[fd00:ec2::254]`). Sin quitarlos, `isIP()` devuelve 0 y la trataríamos como un
  // nombre DNS: en el borde de configuración (`allowUnresolvable`) eso dejaba pasar
  // loopback e incluso la metadata IPv6 de nube. Hallado al escribir los tests de
  // US-227; afecta a todo lo que pasa por aquí, no solo a push.
  const clean =
    trimmed.startsWith('[') && trimmed.endsWith(']') ? trimmed.slice(1, -1) : trimmed;

  if (isIP(clean) !== 0) {
    const reason = blockedReason(clean, policy);
    if (reason) throw new EgressBlockedError(`destino no permitido: ${reason}`, clean);
    return;
  }

  // Resuelve el nombre DNS y comprueba TODAS sus IPs. En el borde de configuración
  // (`allowUnresolvable`) un host que aún no resuelve NO se bloquea: un dispositivo
  // LAN puede estar apagado o su nombre resolverse solo más tarde; solo se rechaza
  // si resuelve a un destino prohibido. En runtime (`safeFetch`) sí es un error.
  let results;
  try {
    results = await lookup(clean, { all: true });
  } catch (err) {
    if (opts.allowUnresolvable) return;
    throw new EgressBlockedError(
      `no se pudo resolver el host: ${err instanceof Error ? err.message : String(err)}`,
      clean,
    );
  }
  if (results.length === 0) {
    if (opts.allowUnresolvable) return;
    throw new EgressBlockedError('el host no resolvió a ninguna dirección', clean);
  }
  for (const { address } of results) {
    const reason = blockedReason(address, policy);
    if (reason) {
      throw new EgressBlockedError(
        `el host ${clean} resuelve a un destino no permitido (${address}): ${reason}`,
        clean,
      );
    }
  }
}

/**
 * Valida una URL completa para una petición saliente: exige esquema `http(s)`,
 * rechaza credenciales embebidas (`user:pass@host`) y comprueba el host contra la
 * política. Devuelve la `URL` parseada.
 */
export async function assertUrlAllowed(
  rawUrl: string,
  policy: EgressPolicy = DEFAULT_EGRESS_POLICY,
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new EgressBlockedError('URL inválida', rawUrl);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new EgressBlockedError(`esquema no permitido: ${url.protocol}`, rawUrl);
  }
  if (url.username || url.password) {
    throw new EgressBlockedError('la URL no puede incluir credenciales embebidas', rawUrl);
  }
  await assertHostAllowed(url.hostname, policy);
  return url;
}

/** Máximo de redirects que sigue `safeFetch` (cada salto se revalida). */
const MAX_REDIRECTS = 3;

/**
 * `fetch` con guardia de egress: valida la URL inicial y **cada redirect** contra
 * la política (un 3xx no puede reapuntar a metadata/interno), en vez de dejar que
 * `fetch` siga redirecciones a ciegas. El resto de opciones se pasan tal cual; el
 * llamante añade su `signal`/timeout y cabeceras.
 */
export async function safeFetch(
  rawUrl: string,
  init: RequestInit = {},
  policy: EgressPolicy = DEFAULT_EGRESS_POLICY,
): Promise<Response> {
  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = await assertUrlAllowed(current, policy);
    const res = await fetch(url, { ...init, redirect: 'manual' });
    // 3xx con Location → validar el destino y volver a pedir manualmente.
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) return res; // redirect sin destino: se devuelve tal cual
      current = new URL(location, url).toString();
      continue;
    }
    return res;
  }
  throw new EgressBlockedError('demasiados redirects', rawUrl);
}
