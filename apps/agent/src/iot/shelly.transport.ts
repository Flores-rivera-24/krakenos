/**
 * Transporte HTTP para **Shelly** (ambas generaciones). El manager no conoce
 * `fetch`: opera contra esta interfaz, lo que permite testear el contrato con un
 * transporte falso (sin dispositivos ni red). La implementación real usa `fetch`
 * (global de Node 20, sin dependencia npm) y añade Basic Auth si está activado.
 */

export interface ShellyTransport {
  /** GET `http://<ip><path>` → JSON (Gen1: `/relay/0?turn=on`, `/status`). */
  get(ip: string, path: string): Promise<unknown>;
  /** POST `http://<ip>/rpc` con el cuerpo JSON-RPC (Gen2) → result. */
  rpc(ip: string, body: unknown): Promise<unknown>;
}

export interface HttpFetchLike {
  (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<{
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
  }>;
}

export interface FetchShellyOptions {
  /** Activa Basic Auth (Gen1 con contraseña, Gen2 siempre admite auth). */
  auth?: boolean;
  username?: string;
  password?: string;
  fetch?: HttpFetchLike;
}

export class ShellyApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const defaultFetch: HttpFetchLike = (url, init) =>
  fetch(url, init).then((res) => ({ ok: res.ok, status: res.status, json: () => res.json() }));

/**
 * Transporte Shelly real sobre `fetch`. Gen1 va por GET a rutas REST; Gen2 por
 * POST a `/rpc` con JSON-RPC 2.0 y devuelve el `result`. No se cubre con unit
 * tests (requiere dispositivos); la lógica testeable vive en `shelly.parsers` y
 * en `ShellyIotManager` con un transporte falso.
 */
export class FetchShellyTransport implements ShellyTransport {
  private readonly fetch: HttpFetchLike;

  constructor(private readonly opts: FetchShellyOptions = {}) {
    this.fetch = opts.fetch ?? defaultFetch;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (this.opts.auth && this.opts.username !== undefined) {
      const token = Buffer.from(`${this.opts.username}:${this.opts.password ?? ''}`).toString('base64');
      headers['Authorization'] = `Basic ${token}`;
    }
    return headers;
  }

  async get(ip: string, path: string): Promise<unknown> {
    const res = await this.fetch(`http://${ip}${path}`, { headers: this.headers() });
    if (!res.ok) throw new ShellyApiError(res.status, `Shelly GET ${path} (${res.status})`);
    return res.json();
  }

  async rpc(ip: string, body: unknown): Promise<unknown> {
    const res = await this.fetch(`http://${ip}/rpc`, {
      method: 'POST',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new ShellyApiError(res.status, `Shelly RPC (${res.status})`);
    const json = (await res.json()) as { result?: unknown; error?: { message?: string } };
    if (json && typeof json === 'object' && 'error' in json && json.error) {
      throw new ShellyApiError(0, `Shelly RPC error: ${json.error.message ?? 'desconocido'}`);
    }
    return json?.result ?? json;
  }
}
