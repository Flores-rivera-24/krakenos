/**
 * Transporte NETCONF para IOS-XE. El driver no conoce SSH/NETCONF: opera contra
 * esta interfaz, lo que permite testear el contrato con un transporte falso. La
 * implementación real (`SshNetconfTransport`) abre el subsistema `netconf` sobre
 * SSH (puerto 830) y enmarca los mensajes con el delimitador NETCONF 1.0.
 */
export interface NetconfTransport {
  /** `<get>` con un filtro de subárbol; devuelve el XML del `<data>`. */
  get(filter: string): Promise<string>;
  /** `<edit-config>` (datastore running) con un fragmento de configuración. */
  editConfig(config: string): Promise<void>;
  /** Cierra la sesión subyacente (no-op en transportes sin estado). */
  dispose?(): Promise<void>;
}

export interface NetconfSshOptions {
  host: string;
  port?: number;
  username: string;
  password?: string;
}

/** Delimitador de fin de mensaje de NETCONF 1.0 (RFC 4742). */
const EOM = ']]>]]>';

const HELLO = `<?xml version="1.0" encoding="UTF-8"?>
<hello xmlns="urn:ietf:params:xml:ns:netconf:base:1.0">
  <capabilities><capability>urn:ietf:params:netconf:base:1.0</capability></capabilities>
</hello>${EOM}`;

/**
 * Transporte NETCONF real sobre el subsistema `netconf` de SSH, con `node-ssh`
 * cargado de forma **perezosa** (no en `package.json`). Tras conectar, abre el
 * subsistema, intercambia `<hello>` y envía cada RPC delimitado por `]]>]]>`,
 * acumulando la respuesta hasta el mismo delimitador.
 *
 * No se cubre con unit tests (requiere `node-ssh`/ssh2 y hardware IOS-XE); su
 * verificación es end-to-end. La lógica testeable vive en los parsers/builders
 * puros y en `CiscoNetconfDriver` con `MockNetconfTransport`.
 */
export class SshNetconfTransport implements NetconfTransport {
  private channel: NodeJS.ReadWriteStream | null = null;
  private ssh: { dispose: () => void } | null = null;
  private messageId = 100;

  constructor(private readonly opts: NetconfSshOptions) {}

  private async channelReady(): Promise<NodeJS.ReadWriteStream> {
    if (this.channel) return this.channel;
    const moduleName = 'node-ssh';
    const mod = (await import(moduleName).catch(() => {
      throw new Error(
        'El driver Cisco NETCONF requiere el paquete "node-ssh". Instálalo en el servidor (pnpm add node-ssh).',
      );
    })) as { NodeSSH: new () => unknown };
    const ssh = new mod.NodeSSH() as {
      connect: (cfg: Record<string, unknown>) => Promise<unknown>;
      dispose: () => void;
      connection?: { subsys: (name: string, cb: (err: Error | undefined, ch: NodeJS.ReadWriteStream) => void) => void };
    };
    await ssh.connect({
      host: this.opts.host,
      port: this.opts.port ?? 830,
      username: this.opts.username,
      password: this.opts.password,
    });
    this.ssh = ssh;
    const channel = await new Promise<NodeJS.ReadWriteStream>((res, rej) => {
      ssh.connection?.subsys('netconf', (err, ch) => (err ? rej(err) : res(ch)));
    });
    channel.write(HELLO); // intercambio de <hello>
    this.channel = channel;
    return channel;
  }

  /** Envía un RPC enmarcado y devuelve la respuesta hasta el delimitador EOM. */
  private async rpc(inner: string): Promise<string> {
    const channel = await this.channelReady();
    const id = this.messageId++;
    const msg = `<rpc message-id="${id}" xmlns="urn:ietf:params:xml:ns:netconf:base:1.0">${inner}</rpc>${EOM}`;
    return new Promise<string>((resolve, reject) => {
      let buf = '';
      const onData = (chunk: Buffer) => {
        buf += chunk.toString('utf8');
        const idx = buf.indexOf(EOM);
        if (idx !== -1) {
          channel.off('data', onData);
          resolve(buf.slice(0, idx));
        }
      };
      channel.on('data', onData);
      channel.on('error', reject);
      channel.write(msg);
    });
  }

  async get(filter: string): Promise<string> {
    return this.rpc(`<get><filter type="subtree">${filter}</filter></get>`);
  }

  async editConfig(config: string): Promise<void> {
    await this.rpc(`<edit-config><target><running/></target><config>${config}</config></edit-config>`);
  }

  async dispose(): Promise<void> {
    this.ssh?.dispose();
    this.ssh = null;
    this.channel = null;
  }
}

/**
 * Transporte NETCONF falso para tests: responde a `get` por coincidencia de
 * subcadena del filtro y registra los `editConfig`.
 */
export class MockNetconfTransport implements NetconfTransport {
  readonly gets: string[] = [];
  readonly edits: string[] = [];
  private rules: { match: string; out: string }[] = [];

  /** Registra una respuesta para los filtros que contengan `match`. */
  on(match: string, output: string): this {
    this.rules.push({ match, out: output });
    return this;
  }

  async get(filter: string): Promise<string> {
    this.gets.push(filter);
    for (const r of this.rules) if (filter.includes(r.match)) return r.out;
    return '<data/>';
  }

  async editConfig(config: string): Promise<void> {
    this.edits.push(config);
  }
}
