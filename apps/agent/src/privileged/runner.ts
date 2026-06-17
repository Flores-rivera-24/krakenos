import { execFile } from 'node:child_process';

export interface CommandResult {
  stdout: string;
  stderr: string;
  code: number;
}

/** Ejecuta comandos privilegiados a través del helper. Inyectable. */
export interface CommandRunner {
  run(argv: string[]): Promise<CommandResult>;
}

/** Error de un comando privilegiado con código de salida distinto de 0. */
export class PrivilegedCommandError extends Error {
  constructor(
    readonly argv: string[],
    readonly result: CommandResult,
  ) {
    super(
      `Comando privilegiado falló (code ${result.code}): ${argv.join(' ')} — ${result.stderr.trim()}`,
    );
  }
}

/** Función de ejecución de bajo nivel; inyectable para tests. */
export type ExecFn = (file: string, args: string[]) => Promise<CommandResult>;

const defaultExec: ExecFn = (file, args) =>
  new Promise((resolve) => {
    execFile(file, args, { timeout: 15_000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      const code =
        err && typeof (err as { code?: unknown }).code === 'number'
          ? (err as { code: number }).code
          : err
            ? 1
            : 0;
      resolve({ stdout: stdout ?? '', stderr: stderr ?? '', code });
    });
  });

export interface SudoHelperRunnerOptions {
  /** Ruta del helper instalado (p. ej. `/usr/local/bin/krakenos-helper`). */
  helperPath: string;
  /** Si es `false`, invoca el helper sin `sudo` (p. ej. el agente ya es root). */
  useSudo?: boolean;
  /** Ejecución de bajo nivel; inyectable para tests. */
  exec?: ExecFn;
}

/**
 * Ejecuta comandos privilegiados invocando el helper con `sudo -n`. El agente
 * nunca llama a los binarios de red directamente: siempre pasa por el helper,
 * cuyo conjunto de comandos permitidos está acotado por sudoers + allowlist.
 */
export class SudoHelperRunner implements CommandRunner {
  private readonly exec: ExecFn;

  constructor(private readonly opts: SudoHelperRunnerOptions) {
    this.exec = opts.exec ?? defaultExec;
  }

  async run(argv: string[]): Promise<CommandResult> {
    const useSudo = this.opts.useSudo ?? true;
    const file = useSudo ? 'sudo' : this.opts.helperPath;
    const args = useSudo ? ['-n', this.opts.helperPath, ...argv] : argv;
    const result = await this.exec(file, args);
    if (result.code !== 0) throw new PrivilegedCommandError(argv, result);
    return result;
  }
}
