/**
 * Cliente HTTP para la **REST API v2 de pfSense** (paquete pfSense API). El
 * driver no conoce `fetch`: opera contra este cliente, que añade la API key,
 * desempaqueta el sobre `{ code, status, data, message }` y normaliza errores.
 * El transporte es inyectable para testear el contrato sin un pfSense real.
 */

export interface HttpResponse {
  status: number;
  ok: boolean;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export interface HttpRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

/** Función de transporte HTTP; inyectable para tests (por defecto `fetch` global). */
export type HttpFetch = (url: string, init?: HttpRequestInit) => Promise<HttpResponse>;

const defaultFetch: HttpFetch = async (url, init) => {
  const res = await fetch(url, init);
  return { status: res.status, ok: res.ok, json: () => res.json(), text: () => res.text() };
};

/** Error de la API de pfSense con el código HTTP y el mensaje del sobre. */
export class PfSenseApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface PfSenseClientOptions {
  /** URL base, p. ej. `https://192.168.1.1`. */
  baseUrl: string;
  /** API key del paquete REST API de pfSense. */
  apiKey: string;
  /** Cabecera donde viaja la API key (por defecto `X-API-Key`). */
  apiKeyHeader?: string;
  fetch?: HttpFetch;
}

/** Sobre de respuesta de la API v2 de pfSense. */
interface Envelope {
  code?: number;
  status?: string;
  message?: string;
  data?: unknown;
}

export class PfSenseClient {
  private readonly baseUrl: string;
  private readonly fetch: HttpFetch;
  private readonly apiKeyHeader: string;

  constructor(private readonly opts: PfSenseClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.fetch = opts.fetch ?? defaultFetch;
    this.apiKeyHeader = opts.apiKeyHeader ?? 'X-API-Key';
  }

  /** Lanza una petición y devuelve el `data` del sobre; lanza si no es 2xx. */
  private async request(path: string, init: HttpRequestInit = {}): Promise<unknown> {
    const res = await this.fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        [this.apiKeyHeader]: this.opts.apiKey,
        ...init.headers,
      },
    });
    const body = (await res.json().catch(() => null)) as Envelope | null;
    if (!res.ok) {
      throw new PfSenseApiError(res.status, body?.message ?? `pfSense API ${path} (${res.status})`);
    }
    return body?.data ?? null;
  }

  get(path: string): Promise<unknown> {
    return this.request(path);
  }

  post(path: string, body: unknown): Promise<unknown> {
    return this.request(path, { method: 'POST', body: JSON.stringify(body) });
  }

  delete(path: string, body?: unknown): Promise<unknown> {
    return this.request(path, {
      method: 'DELETE',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
}
