import { parseTerse } from './mikrotik.parsers.js';

/**
 * Transporte para RouterOS (MikroTik) abstraído como operaciones sobre "menús"
 * (rutas tipo `ip/arp`, `ip/firewall/address-list`, `interface/wireless`). El
 * driver no conoce el protocolo: opera contra esta interfaz, de modo que la
 * lógica (combinar ARP+DHCP, construir el bloqueo, calcular tasas) es la misma en
 * los dos modos. Dos implementaciones:
 *
 * - `RestMikrotikTransport` — REST API de RouterOS 7 (`/rest/<menu>`), Basic Auth.
 * - `SshMikrotikTransport` — SSH+CLI (`/<menu> print terse`), import perezoso de
 *   `node-ssh`. Fallback para RouterOS 6.
 */
export interface MikrotikTransport {
  /** Lista las filas de un menú (`ip/arp` → `[{address, mac-address, …}]`). */
  list(menu: string): Promise<Record<string, unknown>[]>;
  /** Añade una fila a un menú; devuelve el `.id` creado si se conoce. */
  add(menu: string, props: Record<string, string>): Promise<void>;
  /** Modifica la fila `.id` de un menú. */
  set(menu: string, id: string, props: Record<string, string>): Promise<void>;
  /** Elimina la fila `.id` de un menú. */
  remove(menu: string, id: string): Promise<void>;
  dispose?(): Promise<void>;
}

// ---- Modo REST (RouterOS 7) ----

export interface MikrotikHttpResponse {
  status: number;
  ok: boolean;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export interface MikrotikHttpRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export type MikrotikHttpFetch = (
  url: string,
  init?: MikrotikHttpRequestInit,
) => Promise<MikrotikHttpResponse>;

const defaultFetch: MikrotikHttpFetch = async (url, init) => {
  const res = await fetch(url, init);
  return { status: res.status, ok: res.ok, json: () => res.json(), text: () => res.text() };
};

export class MikrotikApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface RestMikrotikOptions {
  /** URL base, p. ej. `https://192.168.88.1`. */
  baseUrl: string;
  username: string;
  password: string;
  fetch?: MikrotikHttpFetch;
}

/** Cabecera Basic Auth a partir de usuario:contraseña. */
function basicAuth(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
}

export class RestMikrotikTransport implements MikrotikTransport {
  private readonly baseUrl: string;
  private readonly fetch: MikrotikHttpFetch;
  private readonly auth: string;

  constructor(opts: RestMikrotikOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.fetch = opts.fetch ?? defaultFetch;
    this.auth = basicAuth(opts.username, opts.password);
  }

  private async request(path: string, init: MikrotikHttpRequestInit = {}): Promise<unknown> {
    const res = await this.fetch(`${this.baseUrl}/rest${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: this.auth,
        ...init.headers,
      },
    });
    if (!res.ok) {
      throw new MikrotikApiError(res.status, `RouterOS REST ${path} (${res.status})`);
    }
    return res.json().catch(() => null);
  }

  async list(menu: string): Promise<Record<string, unknown>[]> {
    const data = await this.request(`/${menu}`);
    return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
  }

  async add(menu: string, props: Record<string, string>): Promise<void> {
    // RouterOS v7: PUT a la colección añade una fila nueva.
    await this.request(`/${menu}`, { method: 'PUT', body: JSON.stringify(props) });
  }

  async set(menu: string, id: string, props: Record<string, string>): Promise<void> {
    await this.request(`/${menu}/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(props),
    });
  }

  async remove(menu: string, id: string): Promise<void> {
    await this.request(`/${menu}/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }
}

// ---- Modo SSH+CLI (fallback RouterOS 6) ----

export interface SshMikrotikOptions {
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKey?: string;
}

/** Convierte un menú REST (`ip/firewall/address-list`) a ruta CLI (`/ip firewall address-list`). */
export function menuToCli(menu: string): string {
  return `/${menu.replace(/\//g, ' ')}`;
}

/** Construye `clave=valor` con comillas si el valor lleva espacios. */
export function cliProps(props: Record<string, string>): string {
  return Object.entries(props)
    .map(([k, v]) => `${k}=${/\s/.test(v) ? `"${v}"` : v}`)
    .join(' ');
}

/**
 * Transporte SSH real sobre `node-ssh` (import **perezoso**, igual que el driver
 * OpenWrt). Traduce las operaciones de menú a comandos CLI de RouterOS y parsea
 * la salida `print terse`. No se cubre con unit tests (requiere `ssh2`/hardware);
 * la lógica testeable vive en `menuToCli`/`cliProps`/`parseTerse` y en el driver
 * con un transporte falso.
 */
export class SshMikrotikTransport implements MikrotikTransport {
  private connection: unknown = null;

  constructor(private readonly opts: SshMikrotikOptions) {}

  private async exec(command: string): Promise<string> {
    if (!this.connection) {
      const moduleName = 'node-ssh';
      const mod = (await import(moduleName).catch(() => {
        throw new Error(
          'El driver MikroTik en modo SSH requiere el paquete "node-ssh". Instálalo en el servidor (pnpm add node-ssh).',
        );
      })) as { NodeSSH: new () => unknown };
      const ssh = new mod.NodeSSH() as {
        connect: (cfg: Record<string, unknown>) => Promise<unknown>;
      };
      await ssh.connect({
        host: this.opts.host,
        port: this.opts.port ?? 22,
        username: this.opts.username,
        password: this.opts.password,
        privateKey: this.opts.privateKey,
      });
      this.connection = ssh;
    }
    const ssh = this.connection as {
      execCommand: (cmd: string) => Promise<{ stdout: string; stderr: string; code: number | null }>;
    };
    const r = await ssh.execCommand(command);
    if (r.code && r.code !== 0) {
      throw new Error(`Comando RouterOS falló (code ${r.code}): ${command} — ${r.stderr.trim()}`);
    }
    return r.stdout;
  }

  async list(menu: string): Promise<Record<string, unknown>[]> {
    return parseTerse(await this.exec(`${menuToCli(menu)} print terse`));
  }

  async add(menu: string, props: Record<string, string>): Promise<void> {
    await this.exec(`${menuToCli(menu)} add ${cliProps(props)}`);
  }

  async set(menu: string, id: string, props: Record<string, string>): Promise<void> {
    await this.exec(`${menuToCli(menu)} set ${id} ${cliProps(props)}`);
  }

  async remove(menu: string, id: string): Promise<void> {
    await this.exec(`${menuToCli(menu)} remove ${id}`);
  }

  async dispose(): Promise<void> {
    if (this.connection) {
      (this.connection as { dispose: () => void }).dispose();
      this.connection = null;
    }
  }
}
