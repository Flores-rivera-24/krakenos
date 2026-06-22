/**
 * Cliente HTTP para la **API local del controller TP-Link Omada** (software u
 * OC200/OC300). El driver no conoce `fetch`: opera contra este cliente, que
 * gestiona el login por cookie (`TPOMADA_SESSIONID`) + el header `Csrf-Token`
 * (token devuelto en el cuerpo del login), desempaqueta el sobre
 * `{ errorCode, msg, result }` y renueva la sesión ante 401/407 o un errorCode de
 * sesión caducada. El transporte es inyectable para testear el contrato sin un
 * controller real (certificado autofirmado → `rejectUnauthorized: false` fuera de
 * este código puro).
 */

export interface OmadaHttpResponse {
  status: number;
  ok: boolean;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export interface OmadaHttpRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export type OmadaHttpFetch = (
  url: string,
  init?: OmadaHttpRequestInit,
) => Promise<OmadaHttpResponse>;

const defaultFetch: OmadaHttpFetch = async (url, init) => {
  const res = await fetch(url, init);
  return {
    status: res.status,
    ok: res.ok,
    headers: { get: (name: string) => res.headers.get(name) },
    json: () => res.json(),
    text: () => res.text(),
  };
};

/** Error de la API de Omada con el `errorCode` (o HTTP) y el mensaje. */
export class OmadaApiError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

export interface OmadaClientOptions {
  /** URL base, p. ej. `https://192.168.1.10:8043`. */
  url: string;
  username: string;
  password: string;
  fetch?: OmadaHttpFetch;
}

/** errorCodes de Omada que indican sesión caducada → reintentar tras re-login. */
const SESSION_EXPIRED = new Set([-1200, -1201, -44112]);

/** Sobre de respuesta de la API de Omada. */
interface Envelope {
  errorCode?: number;
  msg?: string;
  result?: unknown;
}

/** Extrae el valor de la cookie `TPOMADA_SESSIONID` de cabeceras `set-cookie`. */
export function extractOmadaCookie(setCookie: string | null): string | null {
  if (!setCookie) return null;
  const match = setCookie.match(/(?:^|[;,\s])TPOMADA_SESSIONID=([^;,\s]+)/);
  return match ? match[1]! : null;
}

export class OmadaClient {
  private readonly baseUrl: string;
  private readonly fetch: OmadaHttpFetch;
  private sessionCookie: string | null = null;
  private csrfToken: string | null = null;

  constructor(private readonly opts: OmadaClientOptions) {
    this.baseUrl = opts.url.replace(/\/+$/, '');
    this.fetch = opts.fetch ?? defaultFetch;
  }

  /** Inicia sesión: POST `/api/v2/hotspot/login` → cookie + token CSRF (body). */
  async login(): Promise<void> {
    const res = await this.fetch(`${this.baseUrl}/api/v2/hotspot/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ username: this.opts.username, password: this.opts.password }),
    });
    const body = (await res.json().catch(() => null)) as Envelope | null;
    if (!res.ok || (typeof body?.errorCode === 'number' && body.errorCode !== 0)) {
      throw new OmadaApiError(body?.errorCode ?? res.status, body?.msg ?? `Omada login (${res.status})`);
    }
    const cookie = extractOmadaCookie(res.headers.get('set-cookie'));
    if (cookie) this.sessionCookie = cookie;
    const token = (body?.result as { token?: string } | undefined)?.token;
    if (token) this.csrfToken = token;
  }

  private authHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (this.sessionCookie) headers['Cookie'] = `TPOMADA_SESSIONID=${this.sessionCookie}`;
    if (this.csrfToken) headers['Csrf-Token'] = this.csrfToken;
    return headers;
  }

  /**
   * Lanza una petición autenticada y devuelve el `result` del sobre. Hace login
   * si no hay sesión; ante 401/407 o un errorCode de sesión caducada, renueva la
   * cookie y reintenta una sola vez.
   */
  private async request(path: string, init: OmadaHttpRequestInit = {}): Promise<unknown> {
    if (!this.sessionCookie) await this.login();

    const send = () =>
      this.fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: { ...this.authHeaders(), ...init.headers },
      });

    let res = await send();
    let body = (await res.json().catch(() => null)) as Envelope | null;

    const expired =
      res.status === 401 ||
      res.status === 407 ||
      (typeof body?.errorCode === 'number' && SESSION_EXPIRED.has(body.errorCode));
    if (expired) {
      await this.login();
      res = await send();
      body = (await res.json().catch(() => null)) as Envelope | null;
    }

    if (!res.ok || (typeof body?.errorCode === 'number' && body.errorCode !== 0)) {
      throw new OmadaApiError(body?.errorCode ?? res.status, body?.msg ?? `Omada API ${path} (${res.status})`);
    }
    return body?.result ?? null;
  }

  get(path: string): Promise<unknown> {
    return this.request(path);
  }

  post(path: string, body?: unknown): Promise<unknown> {
    return this.request(path, {
      method: 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  patch(path: string, body: unknown): Promise<unknown> {
    return this.request(path, { method: 'PATCH', body: JSON.stringify(body) });
  }
}
