/**
 * Cliente HTTP para la **API local de UniFi Network** (UniFi OS / controller).
 * El driver no conoce `fetch`: opera contra este cliente, que gestiona el login
 * por cookie (`TOKEN`) + el header `Csrf-Token`/`X-CSRF-Token`, renueva la sesión
 * ante un 401 y devuelve el JSON crudo. El transporte es inyectable para testear
 * el contrato sin un controller real (certificado autofirmado → en producción
 * `rejectUnauthorized: false`, fuera de este código puro).
 */

export interface UnifiHttpResponse {
  status: number;
  ok: boolean;
  /** Acceso a cabeceras de respuesta (cookies de sesión, CSRF token). */
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export interface UnifiHttpRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

/** Función de transporte HTTP; inyectable para tests (por defecto `fetch` global). */
export type UnifiHttpFetch = (
  url: string,
  init?: UnifiHttpRequestInit,
) => Promise<UnifiHttpResponse>;

const defaultFetch: UnifiHttpFetch = async (url, init) => {
  const res = await fetch(url, init);
  return {
    status: res.status,
    ok: res.ok,
    headers: { get: (name: string) => res.headers.get(name) },
    json: () => res.json(),
    text: () => res.text(),
  };
};

/** Error de la API de UniFi con el código HTTP y el mensaje. */
export class UnifiApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface UnifiClientOptions {
  /** URL base, p. ej. `https://192.168.1.1`. */
  url: string;
  username: string;
  password: string;
  fetch?: UnifiHttpFetch;
}

/** Extrae el valor de la cookie `TOKEN` de una o varias cabeceras `set-cookie`. */
export function extractTokenCookie(setCookie: string | null): string | null {
  if (!setCookie) return null;
  const match = setCookie.match(/(?:^|[;,\s])TOKEN=([^;,\s]+)/);
  return match ? match[1]! : null;
}

export class UnifiClient {
  private readonly baseUrl: string;
  private readonly fetch: UnifiHttpFetch;
  private tokenCookie: string | null = null;
  private csrfToken: string | null = null;

  constructor(private readonly opts: UnifiClientOptions) {
    this.baseUrl = opts.url.replace(/\/+$/, '');
    this.fetch = opts.fetch ?? defaultFetch;
  }

  /** Inicia sesión: POST `/api/auth/login` → cookie `TOKEN` + CSRF token. */
  async login(): Promise<void> {
    const res = await this.fetch(`${this.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ username: this.opts.username, password: this.opts.password }),
    });
    if (!res.ok) {
      throw new UnifiApiError(res.status, `UniFi login falló (${res.status})`);
    }
    const cookie = extractTokenCookie(res.headers.get('set-cookie'));
    if (cookie) this.tokenCookie = cookie;
    const csrf = res.headers.get('x-csrf-token') ?? res.headers.get('x-updated-csrf-token');
    if (csrf) this.csrfToken = csrf;
  }

  /** Cabeceras de sesión para una petición autenticada. */
  private authHeaders(mutating: boolean): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (this.tokenCookie) headers['Cookie'] = `TOKEN=${this.tokenCookie}`;
    if (mutating && this.csrfToken) {
      headers['X-CSRF-Token'] = this.csrfToken;
      headers['Csrf-Token'] = this.csrfToken;
    }
    return headers;
  }

  /**
   * Lanza una petición autenticada. Si no hay sesión, hace login primero; si la
   * API responde 401 (sesión caducada), renueva la cookie y reintenta una vez.
   */
  private async request(path: string, init: UnifiHttpRequestInit = {}): Promise<unknown> {
    const mutating = (init.method ?? 'GET') !== 'GET';
    if (!this.tokenCookie) await this.login();

    let res = await this.fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { ...this.authHeaders(mutating), ...init.headers },
    });

    if (res.status === 401) {
      // Sesión caducada: renovamos cookie y reintentamos una sola vez.
      await this.login();
      res = await this.fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: { ...this.authHeaders(mutating), ...init.headers },
      });
    }

    // El controller puede rotar el CSRF token en cada respuesta.
    const csrf = res.headers.get('x-csrf-token') ?? res.headers.get('x-updated-csrf-token');
    if (csrf) this.csrfToken = csrf;

    if (!res.ok) {
      throw new UnifiApiError(res.status, `UniFi API ${path} (${res.status})`);
    }
    return res.json().catch(() => null);
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

  put(path: string, body: unknown): Promise<unknown> {
    return this.request(path, { method: 'PUT', body: JSON.stringify(body) });
  }
}
