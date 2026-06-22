import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../../scripts/krakenos-helper.sh', import.meta.url));

/** Ejecuta el helper con bash y captura código de salida y stderr. */
function runHelper(args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    execFile('bash', [SCRIPT, ...args], (err, _stdout, stderr) => {
      const code = err && typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : 0;
      resolve({ code, stderr });
    });
  });
}

describe('krakenos-helper allowlist', () => {
  it('rechaza un comando de nivel superior desconocido', async () => {
    const { code, stderr } = await runHelper(['rm', '-rf', '/']);
    expect(code).toBe(64);
    expect(stderr).toMatch(/no permitido/);
  });

  it('rechaza un subcomando wg no permitido', async () => {
    const { code } = await runHelper(['wg', 'genkey']);
    expect(code).toBe(64);
  });

  it('rechaza un subcomando wg-quick no permitido', async () => {
    const { code } = await runHelper(['wg-quick', 'up']);
    expect(code).toBe(64);
  });

  it('rechaza una operación iptables fuera de la allowlist', async () => {
    const { code } = await runHelper(['iptables', '--version']);
    expect(code).toBe(64);
  });

  it('rechaza un objeto tc fuera de la allowlist', async () => {
    const { code } = await runHelper(['tc', '-help']);
    expect(code).toBe(64);
  });

  it('rechaza una invocación sin argumentos', async () => {
    const { code } = await runHelper([]);
    expect(code).toBe(64);
  });

  // --- Anti-inyección: caracteres de control en cualquier argumento (US-73) ---
  it('rechaza un argumento con salto de línea aunque el verbo sea válido', async () => {
    const { code, stderr } = await runHelper(['wg', 'show', 'wg0\nlisten-port 1', 'dump']);
    expect(code).toBe(64);
    expect(stderr).toMatch(/caracteres de control/);
  });

  it('rechaza un argumento con retorno de carro o tabulador', async () => {
    expect((await runHelper(['iptables', '-L', 'KRAKENOS\rDROP'])).code).toBe(64);
    expect((await runHelper(['tc', 'qdisc', 'show', 'dev', 'eth0\tfoo'])).code).toBe(64);
  });
});
