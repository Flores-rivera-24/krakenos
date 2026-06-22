/**
 * Cliente HTTP para routers **ASUS / Asuswrt-Merlin**. El driver no conoce
 * `fetch`: opera contra este cliente, que añade Basic Auth, consulta el endpoint
 * de lectura `appGet.cgi?hook=...` y aplica cambios por `applyapp.cgi`. El
 * transporte es inyectable para testear el contrato sin un router real.
 */

export interface AsusHttpResponse {
  status: number;
  ok: boolean;
  text(): Promise<string>;
}

export interface AsusHttpRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export type AsusHttpFetch = (url: string, init?: AsusHttpRequestInit) => Promise<AsusHttpResponse>;

const defaultFetch: AsusHttpFetch = async (url, init) => {
  const res = await fetch(url, init);
  return { status: res.status, ok: res.ok, text: () => res.text() };
};

export class AsusApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface AsusClientOptions {
  /** URL base, p. ej. `http://192.168.1.1`. */
  baseUrl: string;
  username: string;
  password: string;
  fetch?: AsusHttpFetch;
}

export class AsusClient {
  private readonly baseUrl: string;
  private readonly fetch: AsusHttpFetch;
  private readonly auth: string;

  constructor(opts: AsusClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.fetch = opts.fetch ?? defaultFetch;
    this.auth = `Basic ${Buffer.from(`${opts.username}:${opts.password}`).toString('base64')}`;
  }

  /** Lee un hook de `appGet.cgi` (`get_clientlist()`, `nvram_get(...)`, …). */
  async get(hook: string): Promise<string> {
    const res = await this.fetch(`${this.baseUrl}/appGet.cgi?hook=${encodeURIComponent(hook)}`, {
      headers: { Authorization: this.auth, Accept: 'application/json' },
    });
    if (!res.ok) throw new AsusApiError(res.status, `ASUS appGet ${hook} (${res.status})`);
    return res.text();
  }

  /**
   * Aplica cambios (nvram set + commit + servicio) por `applyapp.cgi`. Los
   * campos van form-encoded; `action_mode=apply` y `rc_service` (p. ej.
   * `restart_wireless`) disparan el commit y el reinicio del servicio.
   */
  async apply(params: Record<string, string>): Promise<void> {
    const body = new URLSearchParams({ action_mode: 'apply', ...params }).toString();
    const res = await this.fetch(`${this.baseUrl}/applyapp.cgi`, {
      method: 'POST',
      headers: {
        Authorization: this.auth,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });
    if (!res.ok) throw new AsusApiError(res.status, `ASUS applyapp (${res.status})`);
  }
}
