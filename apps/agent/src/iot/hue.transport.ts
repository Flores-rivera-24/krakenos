/**
 * Cliente HTTP para la **CLIP API v2 del Philips Hue bridge**. El manager no
 * conoce `fetch`: opera contra este cliente, que añade la application key,
 * desempaqueta el sobre `{ data, errors }` y normaliza errores. El transporte
 * es inyectable para testear el contrato sin un bridge real.
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

export type HttpFetch = (url: string, init?: HttpRequestInit) => Promise<HttpResponse>;

const defaultFetch: HttpFetch = async (url, init) => {
  const res = await fetch(url, init);
  return { status: res.status, ok: res.ok, json: () => res.json(), text: () => res.text() };
};

export class HueApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface HueClientOptions {
  /** URL base del bridge, p. ej. `https://192.168.1.50`. */
  baseUrl: string;
  /** Application key (header `hue-application-key`). */
  appKey: string;
  fetch?: HttpFetch;
}

interface Envelope {
  data?: unknown;
  errors?: { description?: string }[];
}

export class HueClient {
  private readonly baseUrl: string;
  private readonly fetch: HttpFetch;

  constructor(private readonly opts: HueClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.fetch = opts.fetch ?? defaultFetch;
  }

  private async request(path: string, init: HttpRequestInit = {}): Promise<unknown> {
    const res = await this.fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'hue-application-key': this.opts.appKey,
        ...init.headers,
      },
    });
    const body = (await res.json().catch(() => null)) as Envelope | null;
    if (!res.ok) {
      const detail = body?.errors?.[0]?.description ?? `Hue API ${path} (${res.status})`;
      throw new HueApiError(res.status, detail);
    }
    return body?.data ?? [];
  }

  get(path: string): Promise<unknown> {
    return this.request(path);
  }

  put(path: string, body: unknown): Promise<unknown> {
    return this.request(path, { method: 'PUT', body: JSON.stringify(body) });
  }
}
