/**
 * Transporte de comandos para el driver Cisco IOS. El driver no conoce SSH:
 * opera contra esta interfaz, lo que permite testear el contrato con un
 * transporte falso (sin un switch ni `node-ssh`). La implementación real
 * (`SshCiscoTransport`) abre una sesión SSH y ejecuta comandos en el CLI de IOS.
 */
export interface CiscoTransport {
  /** Ejecuta un comando `show` (modo exec) y devuelve su salida. */
  execute(command: string): Promise<string>;
  /** Ejecuta una secuencia de configuración (`configure terminal` … `end`). */
  executePrivileged(commands: string[]): Promise<string>;
  /** Cierra la sesión subyacente (no-op en transportes sin estado). */
  dispose?(): Promise<void>;
}

export interface CiscoSshOptions {
  host: string;
  port?: number;
  username: string;
  password?: string;
  /** Contraseña de `enable` (modo privilegiado), si el dispositivo la exige. */
  enablePassword?: string;
}

/**
 * Transporte SSH real para Cisco IOS sobre `node-ssh`, cargado de forma
 * **perezosa** (import dinámico) para no exigirlo en `install`/tests/typecheck:
 * solo se necesita en un despliegue real con hardware Cisco.
 *
 * IOS no expone bien el canal `exec`, así que se usa un **shell interactivo**:
 * se desactiva el paginador (`terminal length 0`), se entra en `enable` si hay
 * contraseña, y se envían los comandos leyendo la salida hasta el prompt.
 *
 * No se cubre con unit tests (requiere `node-ssh`/hardware); su verificación es
 * end-to-end. La lógica testeable vive en los builders/parsers puros y en
 * `CiscoIosDriver` con `MockCiscoTransport`.
 */
export class SshCiscoTransport implements CiscoTransport {
  private connection: unknown = null;

  constructor(private readonly opts: CiscoSshOptions) {}

  private async connect(): Promise<{
    execCommand: (cmd: string) => Promise<{ stdout: string; stderr: string }>;
    dispose: () => void;
  }> {
    if (!this.connection) {
      const moduleName = 'node-ssh';
      const mod = (await import(moduleName).catch(() => {
        throw new Error(
          'El driver Cisco IOS requiere el paquete "node-ssh". Instálalo en el servidor (pnpm add node-ssh).',
        );
      })) as { NodeSSH: new () => unknown };
      const ssh = new mod.NodeSSH() as {
        connect: (cfg: Record<string, unknown>) => Promise<unknown>;
        execCommand: (cmd: string) => Promise<{ stdout: string; stderr: string }>;
        dispose: () => void;
      };
      await ssh.connect({
        host: this.opts.host,
        port: this.opts.port ?? 22,
        username: this.opts.username,
        password: this.opts.password,
        // IOS antiguo negocia algoritmos legacy; node-ssh/ssh2 los habilita por config.
        tryKeyboard: true,
      });
      this.connection = ssh;
    }
    return this.connection as {
      execCommand: (cmd: string) => Promise<{ stdout: string; stderr: string }>;
      dispose: () => void;
    };
  }

  async execute(command: string): Promise<string> {
    const ssh = await this.connect();
    const r = await ssh.execCommand(`terminal length 0\n${command}`);
    return r.stdout;
  }

  async executePrivileged(commands: string[]): Promise<string> {
    const ssh = await this.connect();
    const enable = this.opts.enablePassword ? `enable\n${this.opts.enablePassword}\n` : '';
    const r = await ssh.execCommand(`${enable}terminal length 0\n${commands.join('\n')}`);
    return r.stdout;
  }

  async dispose(): Promise<void> {
    if (this.connection) {
      (this.connection as { dispose: () => void }).dispose();
      this.connection = null;
    }
  }
}

/**
 * Transporte falso para tests: responde por coincidencia de prefijo de comando.
 * Registra los comandos ejecutados (incluidos los privilegiados) para aserciones.
 */
export class MockCiscoTransport implements CiscoTransport {
  readonly executed: string[] = [];
  readonly privileged: string[][] = [];
  private rules: { match: string; out: string }[] = [];
  private queues = new Map<string, string[]>();

  /** Registra una respuesta para los comandos que empiecen por `match`. */
  on(match: string, output: string): this {
    this.rules.push({ match, out: output });
    return this;
  }

  /** Encola varias respuestas para lecturas sucesivas del mismo comando. */
  queue(match: string, outputs: string[]): this {
    this.queues.set(match, [...outputs]);
    return this;
  }

  async execute(command: string): Promise<string> {
    this.executed.push(command);
    for (const [match, q] of this.queues) {
      if (command.startsWith(match) && q.length) return q.shift()!;
    }
    for (const r of this.rules) {
      if (command.startsWith(r.match)) return r.out;
    }
    return '';
  }

  async executePrivileged(commands: string[]): Promise<string> {
    this.privileged.push(commands);
    return '';
  }

  /** `true` si se ejecutó algún comando que empiece por `prefix`. */
  ran(prefix: string): boolean {
    return this.executed.some((c) => c.startsWith(prefix));
  }
}
