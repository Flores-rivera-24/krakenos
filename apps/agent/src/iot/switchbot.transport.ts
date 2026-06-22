/**
 * Transporte HTTP para la **API REST local de SwitchBot** (Hub Mini/Hub 2). El
 * manager no conoce `fetch`: opera contra esta interfaz, lo que permite testear
 * el contrato con un transporte falso. La implementación real usa `fetch` (global
 * de Node 20, sin dependencia npm) y desempaqueta el sobre `{statusCode, body}`.
 */

export interface SwitchBotTransport {
  /** GET de un path (`/v1.0/devices`) → `body` del sobre. */
  get(path: string): Promise<unknown>;
  /** POST de un path (`/v1.0/devices/<id>/commands`) → `body` del sobre. */
  post(path: string, body: unknown): Promise<unknown>;
}

export interface SwitchBotHttpResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type SwitchBotHttpFetch = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<SwitchBotHttpResponse>;

const defaultFetch: SwitchBotHttpFetch = (url, init) =>
  fetch(url, init).then((res) => ({ ok: res.ok, status: res.status, json: () => res.json() }));

export class SwitchBotApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface FetchSwitchBotOptions {
  /** URL base, p. ej. `http://192.168.1.90:8123`. */
  baseUrl: string;
  /** Token de autorización (header `Authorization`). */
  token?: string;
  fetch?: SwitchBotHttpFetch;
}

/** Sobre de respuesta de la API SwitchBot. */
interface Envelope {
  statusCode?: number;
  body?: unknown;
  message?: string;
}

export class FetchSwitchBotTransport implements SwitchBotTransport {
  private readonly baseUrl: string;
  private readonly fetch: SwitchBotHttpFetch;

  constructor(private readonly opts: FetchSwitchBotOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.fetch = opts.fetch ?? defaultFetch;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (this.opts.token) headers['Authorization'] = this.opts.token;
    return headers;
  }

  private async request(path: string, init: { method?: string; body?: string } = {}): Promise<unknown> {
    const res = await this.fetch(`${this.baseUrl}${path}`, { ...init, headers: this.headers() });
    const env = (await res.json().catch(() => null)) as Envelope | null;
    if (!res.ok) throw new SwitchBotApiError(res.status, `SwitchBot ${path} (${res.status})`);
    // statusCode 100 = OK en la API SwitchBot; cualquier otro es error.
    if (typeof env?.statusCode === 'number' && env.statusCode !== 100) {
      throw new SwitchBotApiError(env.statusCode, env.message ?? `SwitchBot ${path} (${env.statusCode})`);
    }
    return env?.body ?? env ?? null;
  }

  get(path: string): Promise<unknown> {
    return this.request(path);
  }

  post(path: string, body: unknown): Promise<unknown> {
    return this.request(path, { method: 'POST', body: JSON.stringify(body) });
  }
}
