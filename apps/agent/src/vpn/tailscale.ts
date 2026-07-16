import http from 'node:http';
import type { TailscaleStatus } from '@krakenos/types';

/**
 * Detección de Tailscale (US-215): habla con la LocalAPI de `tailscaled` a
 * través de su **socket UNIX** local — nunca sale a la red (no pasa por
 * `safeFetch` porque no hay URL ni host que filtrar: el transporte solo admite
 * un `socketPath`). La app detecta, guía y muestra; no administra el tailnet
 * (`tailscale up` es interactivo/OAuth y se hace por SSH, fuera de la app).
 */

/** Transporte hacia la LocalAPI de tailscaled. Inyectable para tests. */
export interface TailscaleTransport {
  /**
   * Devuelve el cuerpo JSON crudo de `GET /localapi/v0/status`. Lanza el error
   * de socket original (ENOENT/ECONNREFUSED/…) si el daemon no responde.
   */
  fetchStatus(): Promise<string>;
}

/**
 * Opciones de la petición a la LocalAPI. Puro y exportado para poder asegurar
 * en tests el invariante de no-egress: la petición viaja por `socketPath` y NO
 * lleva `host` ni `port` (jamás abre una conexión de red).
 */
export function buildLocalApiRequestOptions(socketPath: string) {
  return {
    socketPath,
    path: '/localapi/v0/status',
    method: 'GET',
    // La LocalAPI exige un Host simbólico; no es un destino de red.
    headers: { Host: 'local-tailscaled.sock' },
  } as const;
}

/**
 * Clasifica el fallo del socket en un estado honesto: sin fichero de socket →
 * `not-installed` (no hay rastro de tailscaled); cualquier otro fallo
 * (conexión rechazada, permisos, timeout) → `stopped` (hay rastro, pero el
 * daemon no responde).
 */
export function classifyTransportError(err: unknown): 'not-installed' | 'stopped' {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR' ? 'not-installed' : 'stopped';
}

const EMPTY: Omit<TailscaleStatus, 'state'> = {
  tailscaleIp: null,
  magicDnsName: null,
  version: null,
};

/**
 * Parser **puro** del JSON de `/localapi/v0/status`. Defensivo: un cuerpo
 * corrupto o con campos ausentes degrada a `stopped` con nulls, nunca lanza.
 */
export function parseTailscaleStatusJson(raw: string): TailscaleStatus {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { state: 'stopped', ...EMPTY };
  }
  if (typeof data !== 'object' || data === null) return { state: 'stopped', ...EMPTY };
  const status = data as Record<string, unknown>;

  const backend = typeof status.BackendState === 'string' ? status.BackendState : '';
  const state =
    backend === 'Running'
      ? 'running'
      : backend === 'NeedsLogin' || backend === 'NeedsMachineAuth'
        ? 'needs-login'
        : 'stopped';

  const self =
    typeof status.Self === 'object' && status.Self !== null
      ? (status.Self as Record<string, unknown>)
      : {};
  const ips = Array.isArray(self.TailscaleIPs)
    ? self.TailscaleIPs.filter((ip): ip is string => typeof ip === 'string')
    : [];
  // Preferimos la IPv4 del tailnet (100.x.y.z); si solo hay IPv6, se muestra esa.
  const tailscaleIp = ips.find((ip) => !ip.includes(':')) ?? ips[0] ?? null;
  const dnsName = typeof self.DNSName === 'string' ? self.DNSName.replace(/\.$/, '') : '';

  return {
    state,
    // Los datos de red solo tienen sentido con el backend corriendo.
    tailscaleIp: state === 'running' ? tailscaleIp : null,
    magicDnsName: state === 'running' && dnsName ? dnsName : null,
    version: typeof status.Version === 'string' && status.Version ? status.Version : null,
  };
}

/** Detecta el estado combinando transporte + parser; nunca lanza. */
export async function detectTailscale(transport: TailscaleTransport): Promise<TailscaleStatus> {
  try {
    return parseTailscaleStatusJson(await transport.fetchStatus());
  } catch (err) {
    return { state: classifyTransportError(err), ...EMPTY };
  }
}

/** Ruta por defecto del socket de tailscaled en Linux. */
export const DEFAULT_TAILSCALE_SOCKET = '/var/run/tailscale/tailscaled.sock';

const LOCALAPI_TIMEOUT_MS = 2000;

/** Transporte real sobre el socket UNIX (`node:http` con `socketPath`). */
export function createTailscaleTransport(socketPath: string): TailscaleTransport {
  return {
    fetchStatus() {
      return new Promise<string>((resolvePromise, reject) => {
        const req = http.request(buildLocalApiRequestOptions(socketPath), (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => resolvePromise(Buffer.concat(chunks).toString('utf8')));
          res.on('error', reject);
        });
        req.setTimeout(LOCALAPI_TIMEOUT_MS, () => req.destroy(new Error('LocalAPI timeout')));
        req.on('error', reject);
        req.end();
      });
    },
  };
}
