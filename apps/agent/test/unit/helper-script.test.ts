import { execFile } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../../scripts/krakenos-helper.sh', import.meta.url));

// Directorio con stubs de `wg`/`wg-quick`/`iptables`/`tc` que salen 0. Así las
// rutas PERMITIDAS por la allowlist llegan al `exec` y devuelven 0 (en vez de
// fallar por falta de root o de binario), mientras que las DENEGADAS salen 64
// antes de ejecutar nada.
let binDir: string;

/** Ejecuta el helper con bash y captura código de salida y stderr. */
function runHelper(
  args: string[],
  env: NodeJS.ProcessEnv = {},
): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      'bash',
      [SCRIPT, ...args],
      // PATH con los stubs delante para que `exec wg`/`tc`/`iptables` los use;
      // KRAKENOS_HELPER_CONF a un fichero inexistente para no leer config del host.
      { env: { ...process.env, PATH: `${binDir}:${process.env.PATH}`, KRAKENOS_HELPER_CONF: '/dev/null/none', ...env } },
      (err, _stdout, stderr) => {
        const code = err && typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : 0;
        resolve({ code, stderr });
      },
    );
  });
}

beforeAll(() => {
  binDir = mkdtempSync(join(tmpdir(), 'kraken-helper-stubs-'));
  for (const name of ['wg', 'wg-quick', 'iptables', 'tc']) {
    const p = join(binDir, name);
    writeFileSync(p, '#!/usr/bin/env bash\nexit 0\n');
    chmodSync(p, 0o755);
  }
});

afterAll(() => {
  rmSync(binDir, { recursive: true, force: true });
});

describe('krakenos-helper allowlist (verbo)', () => {
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
    const { code } = await runHelper(['wg-quick', 'up', 'wg0']);
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
});

describe('krakenos-helper anti-inyección (caracteres de control)', () => {
  it('rechaza un argumento con salto de línea aunque el verbo sea válido', async () => {
    const { code, stderr } = await runHelper(['wg', 'show', 'wg0\nlisten-port 1', 'dump']);
    expect(code).toBe(64);
    expect(stderr).toMatch(/caracteres de control/);
  });

  it('rechaza un argumento con retorno de carro o tabulador', async () => {
    expect((await runHelper(['iptables', '-A', 'KRAKENOS\rDROP'])).code).toBe(64);
    expect((await runHelper(['tc', 'qdisc', 'show', 'dev', 'eth0\tfoo'])).code).toBe(64);
  });
});

// --- US-74 · allowlist por ÁMBITO (F1) ---
describe('krakenos-helper allowlist por ámbito (US-74)', () => {
  describe('iptables — solo la cadena dedicada y su enlace en FORWARD', () => {
    it('permite las operaciones reales del firewall sobre la cadena KRAKENOS', async () => {
      expect((await runHelper(['iptables', '-N', 'KRAKENOS'])).code).toBe(0);
      expect((await runHelper(['iptables', '-F', 'KRAKENOS'])).code).toBe(0);
      expect(
        (await runHelper(['iptables', '-A', 'KRAKENOS', '-p', 'tcp', '--dport', '443', '-j', 'DROP'])).code,
      ).toBe(0);
    });

    it('permite enlazar/comprobar el salto desde FORWARD solo hacia la cadena', async () => {
      expect((await runHelper(['iptables', '-C', 'FORWARD', '-j', 'KRAKENOS'])).code).toBe(0);
      expect((await runHelper(['iptables', '-A', 'FORWARD', '-j', 'KRAKENOS'])).code).toBe(0);
      expect((await runHelper(['iptables', '-D', 'FORWARD', '-j', 'KRAKENOS'])).code).toBe(0);
    });

    it('rechaza operar sobre cualquier otra cadena', async () => {
      expect((await runHelper(['iptables', '-A', 'INPUT', '-j', 'ACCEPT'])).code).toBe(64);
      expect((await runHelper(['iptables', '-F', 'OUTPUT'])).code).toBe(64);
      expect((await runHelper(['iptables', '-F'])).code).toBe(64); // -F sin cadena = flush total
    });

    it('rechaza reglas arbitrarias en FORWARD (solo el salto exacto a la cadena)', async () => {
      expect((await runHelper(['iptables', '-A', 'FORWARD', '-j', 'ACCEPT'])).code).toBe(64);
      expect((await runHelper(['iptables', '-A', 'FORWARD', '-j', 'KRAKENOS', '-p', 'tcp'])).code).toBe(64);
      expect((await runHelper(['iptables', '-F', 'FORWARD'])).code).toBe(64);
    });

    it('rechaza tocar otra tabla distinta de filter (-t/--table)', async () => {
      expect((await runHelper(['iptables', '-t', 'nat', '-A', 'KRAKENOS', '-j', 'MASQUERADE'])).code).toBe(64);
      expect((await runHelper(['iptables', '-A', 'KRAKENOS', '--table', 'nat', '-j', 'ACCEPT'])).code).toBe(64);
    });
  });

  describe('tc — solo la interfaz de QoS configurada', () => {
    it('permite qdisc/class/filter sobre la interfaz por defecto (eth0)', async () => {
      expect((await runHelper(['tc', 'qdisc', 'del', 'dev', 'eth0', 'root'])).code).toBe(0);
      expect(
        (await runHelper(['tc', 'qdisc', 'add', 'dev', 'eth0', 'root', 'handle', '1:', 'htb', 'default', '99'])).code,
      ).toBe(0);
      expect(
        (await runHelper(['tc', 'filter', 'add', 'dev', 'eth0', 'protocol', 'ip', 'parent', '1:', 'prio', '1', 'u32', 'match', 'ip', 'dst', '10.0.0.5', 'flowid', '1:10'])).code,
      ).toBe(0);
    });

    it('rechaza otra interfaz', async () => {
      expect((await runHelper(['tc', 'qdisc', 'del', 'dev', 'eth1', 'root'])).code).toBe(64);
      expect((await runHelper(['tc', 'qdisc', 'del', 'dev', 'wg0', 'root'])).code).toBe(64);
    });

    it('rechaza una operación tc sin "dev <iface>"', async () => {
      expect((await runHelper(['tc', 'qdisc', 'show'])).code).toBe(64);
    });
  });

  describe('wg / wg-quick — solo la interfaz WireGuard', () => {
    it('permite show/set y wg-quick save sobre wg0', async () => {
      expect((await runHelper(['wg', 'show', 'wg0', 'dump'])).code).toBe(0);
      expect((await runHelper(['wg', 'show', 'wg0', 'public-key'])).code).toBe(0);
      expect((await runHelper(['wg', 'set', 'wg0', 'peer', 'AAA=', 'remove'])).code).toBe(0);
      expect((await runHelper(['wg-quick', 'save', 'wg0'])).code).toBe(0);
    });

    it('rechaza otra interfaz', async () => {
      expect((await runHelper(['wg', 'show', 'wg1', 'dump'])).code).toBe(64);
      expect((await runHelper(['wg', 'set', 'eth0', 'peer', 'AAA=', 'remove'])).code).toBe(64);
      expect((await runHelper(['wg-quick', 'save', 'wg1'])).code).toBe(64);
    });
  });

  describe('ámbito configurable (root-owned, no por el agente)', () => {
    const scope = { KRAKENOS_FW_CHAIN: 'MYCHAIN', KRAKENOS_TC_IFACE: 'enp3s0', KRAKENOS_WG_IFACE: 'wg9' };

    it('permite el ámbito configurado y rechaza el por defecto', async () => {
      expect((await runHelper(['iptables', '-F', 'MYCHAIN'], scope)).code).toBe(0);
      expect((await runHelper(['iptables', '-A', 'FORWARD', '-j', 'MYCHAIN'], scope)).code).toBe(0);
      expect((await runHelper(['tc', 'qdisc', 'del', 'dev', 'enp3s0', 'root'], scope)).code).toBe(0);
      expect((await runHelper(['wg', 'show', 'wg9', 'dump'], scope)).code).toBe(0);

      // Con un ámbito a medida, los defaults dejan de estar permitidos.
      expect((await runHelper(['iptables', '-F', 'KRAKENOS'], scope)).code).toBe(64);
      expect((await runHelper(['tc', 'qdisc', 'del', 'dev', 'eth0', 'root'], scope)).code).toBe(64);
      expect((await runHelper(['wg', 'show', 'wg0', 'dump'], scope)).code).toBe(64);
    });
  });
});
