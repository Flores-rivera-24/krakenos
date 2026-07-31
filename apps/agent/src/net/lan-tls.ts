import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Agent } from 'undici';
import { DEFAULT_EGRESS_POLICY, blockedReason, extractHost } from './egress.js';

/**
 * Excepción de verificación TLS **acotada a un aparato de la LAN** (US-259).
 *
 * El problema: el bridge Philips Hue sirve su API local por HTTPS con un
 * certificado **autofirmado**, así que `fetch` lo rechaza. La solución que
 * documentaban `hue-setup.md` y `composite-iot-setup.md` era
 * `NODE_TLS_REJECT_UNAUTHORIZED=0`, que apaga la validación TLS de **todo el
 * proceso**: con eso puesto, el aviso a Telegram, la comprobación de
 * actualizaciones y el Web Push dejan también de verificar a quién hablan. Un
 * aparato de la LAN acababa degradando la seguridad de todo lo demás.
 *
 * Aquí la excepción viaja en un `dispatcher` de undici que se aplica **solo a las
 * peticiones que la piden**, y encima únicamente si el destino resuelve a una
 * dirección **privada o loopback**. Si alguien apunta `HUE_BRIDGE_URL` a un host
 * público, la verificación sigue activa: se prefiere fallar a bajar la guardia
 * contra internet sin decirlo.
 *
 * ⚠️ **Lo que esto NO resuelve.** Dentro de la LAN sigue sin haber autenticación
 * del servidor: quien pueda suplantar la IP del bridge puede hacerse pasar por él.
 * Cerrar eso del todo exige fijar el certificado (TOFU al emparejar, o validar
 * contra la CA de Philips), que es trabajo aparte. Lo que se gana aquí es acotar
 * el radio: de «todo el proceso» a «esta conexión a esta IP de mi red».
 */

/** Cliente con verificación TLS desactivada. Perezoso y único (cada `Agent` es un pool). */
let agenteLan: Agent | null = null;

function dispatcherLan(): Agent {
  // Supresión **deliberada y acotada a esta línea** (US-259). Se silencia aquí y no
  // con un `--exclude-rule` en el workflow a propósito: excluir la regla apagaría la
  // detección en TODO el repo y el próximo bypass —ese sí accidental— pasaría
  // callado. La regla tiene razón en el caso general; este es el caso concreto en
  // que el proyecto la asume, y por eso lleva su porqué al lado:
  //
  //  - El destino es un bridge Philips Hue en una IP privada. Un certificado
  //    públicamente válido para `https://192.168.1.50` **no existe**, así que no hay
  //    «usa un cert bien emitido» posible aquí.
  //  - Lo que había antes era PEOR y es lo que esto sustituye: las guías pedían
  //    `NODE_TLS_REJECT_UNAUTHORIZED=0`, que apaga la validación del proceso entero
  //    —Telegram, update-check y Web Push incluidos—. Esto lo baja a una conexión.
  //  - `initConTlsDeLan` solo entrega este dispatcher si el host resuelve a una IP
  //    privada; contra internet la verificación sigue intacta.
  //  - Riesgo residual, asumido y escrito en `docs/hue-setup.md`: dentro de la LAN el
  //    bridge no queda autenticado. Cerrarlo es fijar el certificado (TOFU o CA de
  //    Philips) y necesita hardware real (US-86).
  //
  // ⚠️ El marcador va en la línea INMEDIATAMENTE anterior al hallazgo: semgrep solo
  // mira esa (o la propia línea). Con la explicación en medio no suprime nada.
  // nosemgrep: problem-based-packs.insecure-transport.js-node.bypass-tls-verification.bypass-tls-verification
  agenteLan ??= new Agent({ connect: { rejectUnauthorized: false } });
  return agenteLan;
}

/** Cierra el pool (tests y apagado limpio). */
export async function cerrarDispatcherLan(): Promise<void> {
  if (!agenteLan) return;
  const a = agenteLan;
  agenteLan = null;
  await a.close();
}

/** Caché host → ¿resuelve a una dirección de LAN? (evita un lookup por petición). */
const cacheLan = new Map<string, boolean>();

/**
 * ¿El host apunta a la red local? Se responde comparando las dos políticas de
 * egress: una IP privada/loopback es la que la política por defecto **permite** y
 * la estricta **bloquea**. Así la definición de «LAN» no se duplica aquí.
 */
export async function esHostDeLan(rawUrl: string): Promise<boolean> {
  const host = extractHost(rawUrl);
  if (!host) return false;
  const cacheado = cacheLan.get(host);
  if (cacheado !== undefined) return cacheado;

  let ips: string[];
  if (isIP(host)) {
    ips = [host];
  } else {
    try {
      ips = (await lookup(host, { all: true })).map((r) => r.address);
    } catch {
      return false; // no resuelve → no se le regala la excepción
    }
  }
  // Todas las IPs deben ser de LAN: si un nombre resuelve a una privada y a una
  // pública, no es «un aparato de casa».
  const esLan =
    ips.length > 0 &&
    ips.every(
      (ip) =>
        blockedReason(ip, DEFAULT_EGRESS_POLICY) === null &&
        blockedReason(ip, { blockPrivate: true }) !== null,
    );
  cacheLan.set(host, esLan);
  return esLan;
}

/**
 * `init` con el dispatcher que salta la verificación TLS, **solo** si la URL
 * apunta a la LAN. Si no, devuelve el `init` intacto y la petición se verifica
 * como cualquier otra.
 */
export async function initConTlsDeLan<T extends object>(rawUrl: string, init: T): Promise<T> {
  if (!(await esHostDeLan(rawUrl))) return init;
  // `dispatcher` es una extensión de undici que el `fetch` de Node acepta pero que
  // no está en el tipo estándar `RequestInit`; de ahí el cast.
  return { ...init, dispatcher: dispatcherLan() } as T;
}

/** Vacía la caché de resolución (tests). */
export function _resetCacheLan(): void {
  cacheLan.clear();
}
