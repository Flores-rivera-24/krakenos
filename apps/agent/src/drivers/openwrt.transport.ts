/**
 * Transporte de comandos para el driver OpenWrt. El driver no conoce SSH: opera
 * contra esta interfaz, lo que permite testear el contrato con un transporte
 * falso (sin un router ni `ssh2`). La implementación real (`SshTransport`) abre
 * una sesión SSH y ejecuta comandos en el dispositivo.
 */
export interface CommandOutput {
  stdout: string;
  stderr: string;
  code: number;
}

/** Ejecuta un comando de shell en el dispositivo OpenWrt y devuelve su salida. */
export interface OpenWrtTransport {
  exec(command: string): Promise<CommandOutput>;
  /** Cierra la sesión subyacente (no-op en transportes sin estado). */
  dispose?(): Promise<void>;
}

export interface SshTransportOptions {
  host: string;
  port?: number;
  username: string;
  /** Contraseña SSH, o usa `privateKey`. */
  password?: string;
  /** Clave privada PEM, alternativa a `password`. */
  privateKey?: string;
}

/**
 * Transporte SSH real sobre `node-ssh`. La dependencia se carga de forma
 * **perezosa** (import dinámico) para no exigirla en `install`/tests/typecheck:
 * solo se necesita en un despliegue real con un router OpenWrt. La conexión se
 * reutiliza entre comandos y se cierra con `dispose()`.
 *
 * No se cubre con unit tests (requiere `ssh2`/hardware); su verificación es
 * end-to-end en el despliegue. La lógica testeable vive en los builders/parsers
 * puros y en `OpenWrtDriver` con un transporte falso.
 */
export class SshTransport implements OpenWrtTransport {
  // Conexión `node-ssh` perezosa; tipada de forma laxa por el import dinámico.
  private connection: unknown = null;

  constructor(private readonly opts: SshTransportOptions) {}

  private async connect(): Promise<{ execCommand: (cmd: string) => Promise<CommandOutput>; dispose: () => void }> {
    if (!this.connection) {
      // Import dinámico con especificador no-literal: `node-ssh` es opcional y
      // solo se instala en producción, así que TS no debe resolverlo en build.
      const moduleName = 'node-ssh';
      const mod = (await import(moduleName).catch(() => {
        throw new Error(
          'El driver OpenWrt requiere el paquete "node-ssh". Instálalo en el servidor (pnpm add node-ssh).',
        );
      })) as { NodeSSH: new () => unknown };
      const ssh = new mod.NodeSSH() as {
        connect: (cfg: Record<string, unknown>) => Promise<unknown>;
        execCommand: (cmd: string) => Promise<{ stdout: string; stderr: string; code: number | null }>;
        dispose: () => void;
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
      dispose: () => void;
    };
    return {
      execCommand: async (cmd) => {
        const r = await ssh.execCommand(cmd);
        return { stdout: r.stdout, stderr: r.stderr, code: r.code ?? 0 };
      },
      dispose: () => ssh.dispose(),
    };
  }

  async exec(command: string): Promise<CommandOutput> {
    const conn = await this.connect();
    return conn.execCommand(command);
  }

  async dispose(): Promise<void> {
    if (this.connection) {
      (this.connection as { dispose: () => void }).dispose();
      this.connection = null;
    }
  }
}
