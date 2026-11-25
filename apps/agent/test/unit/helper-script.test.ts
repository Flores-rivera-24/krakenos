import { execFile, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FirewallRule } from '@krakenos/types';
import {
  iptablesAppendArgsForRule,
  iptablesCheckLinkArgs,
  iptablesFlushArgs,
  iptablesLinkArgs,
  iptablesNewChainArgs,
} from '../../src/firewall/iptables.helpers.js';
import {
  tcFilterIpArgs,
  tcLeafClassArgs,
  tcQdiscAddRootArgs,
  tcQdiscDelRootArgs,
  tcRootClassArgs,
} from '../../src/qos/tc.helpers.js';

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
      // Stubs delante en PATH + KRAKENOS_HELPER_KEEP_PATH=1 (solo se honra siendo no-root) para que `exec wg`/`tc`/`iptables` los use;
      // KRAKENOS_HELPER_CONF a un fichero inexistente para no leer config del host.
      {
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH}`,
          KRAKENOS_HELPER_KEEP_PATH: '1',
          KRAKENOS_HELPER_CONF: '/dev/null/none',
          ...env,
        },
      },
      (err, _stdout, stderr) => {
        const code =
          err && typeof (err as { code?: unknown }).code === 'number'
            ? (err as { code: number }).code
            : 0;
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

const WGKEY = 'A'.repeat(43) + '=';

describe('krakenos-helper anti-inyección (caracteres de control)', () => {
  it('rechaza un argumento con salto de línea aunque el verbo sea válido', async () => {
    const { code, stderr } = await runHelper(['wg', 'show', 'wg0\nlisten-port 1', 'public-key']);
    expect(code).toBe(64);
    expect(stderr).toMatch(/caracteres de control/);
  });

  // En el runner de Windows el helper devuelve 0 (no 64) con un \r en el argumento. Causa NO investigada:
  // el helper es de Linux (sudoers; en Windows VPN/cortafuegos/QoS se declaran no disponibles) y no corre allí.
  it.skipIf(process.platform === 'win32')('rechaza un argumento con retorno de carro', async () => {
    expect((await runHelper(['iptables', '-A', 'KRAKENOS\rDROP'])).code).toBe(64);
  });

  it('rechaza un argumento con tabulador', async () => {
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
        (
          await runHelper([
            'iptables',
            '-A',
            'KRAKENOS',
            '-p',
            'tcp',
            '--dport',
            '443',
            '-j',
            'DROP',
          ])
        ).code,
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
      expect(
        (await runHelper(['iptables', '-A', 'FORWARD', '-j', 'KRAKENOS', '-p', 'tcp'])).code,
      ).toBe(64);
      expect((await runHelper(['iptables', '-F', 'FORWARD'])).code).toBe(64);
    });

    it('rechaza tocar otra tabla distinta de filter (-t/--table)', async () => {
      expect(
        (await runHelper(['iptables', '-t', 'nat', '-A', 'KRAKENOS', '-j', 'MASQUERADE'])).code,
      ).toBe(64);
      expect(
        (await runHelper(['iptables', '-A', 'KRAKENOS', '--table', 'nat', '-j', 'ACCEPT'])).code,
      ).toBe(64);
    });
  });

  describe('tc — solo la interfaz de QoS configurada', () => {
    it('permite qdisc/class/filter sobre la interfaz por defecto (eth0)', async () => {
      expect((await runHelper(['tc', 'qdisc', 'del', 'dev', 'eth0', 'root'])).code).toBe(0);
      expect(
        (
          await runHelper([
            'tc',
            'qdisc',
            'add',
            'dev',
            'eth0',
            'root',
            'handle',
            '1:',
            'htb',
            'default',
            '99',
          ])
        ).code,
      ).toBe(0);
      expect(
        (
          await runHelper([
            'tc',
            'filter',
            'add',
            'dev',
            'eth0',
            'protocol',
            'ip',
            'parent',
            '1:',
            'prio',
            '1',
            'u32',
            'match',
            'ip',
            'dst',
            '10.0.0.5',
            'flowid',
            '1:10',
          ])
        ).code,
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
      expect((await runHelper(['wg', 'show', 'wg0', 'latest-handshakes'])).code).toBe(0);
      expect((await runHelper(['wg', 'show', 'wg0', 'public-key'])).code).toBe(0);
      expect((await runHelper(['wg', 'set', 'wg0', 'peer', WGKEY, 'remove'])).code).toBe(0);
      expect(
        (await runHelper(['wg', 'set', 'wg0', 'peer', WGKEY, 'allowed-ips', '10.8.0.7/32'])).code,
      ).toBe(0);
      expect((await runHelper(['wg-quick', 'save', 'wg0'])).code).toBe(0);
    });

    it('rechaza otra interfaz', async () => {
      expect((await runHelper(['wg', 'show', 'wg1', 'latest-handshakes'])).code).toBe(64);
      expect((await runHelper(['wg', 'set', 'eth0', 'peer', WGKEY, 'remove'])).code).toBe(64);
      expect((await runHelper(['wg-quick', 'save', 'wg1'])).code).toBe(64);
    });

    it('cierra lo que filtraría claves o leería ficheros de root', async () => {
      const malos = [
        ['wg', 'show', 'wg0', 'dump'],
        ['wg', 'show', 'wg0'],
        ['wg', 'show', 'wg0', 'private-key'],
        ['wg', 'show', 'wg0', 'preshared-keys'],
        ['wg', 'show', 'wg0', 'public-key', 'extra'],
        ['wg', 'show', 'all', 'dump'],
        ['wg', 'set', 'wg0', 'private-key', '/etc/shadow'],
        ['wg', 'set', 'wg0', 'peer', WGKEY, 'preshared-key', '/etc/shadow'],
        ['wg', 'set', 'wg0', 'peer', WGKEY, 'allowed-ips', '0.0.0.0/0'],
        ['wg', 'set', 'wg0', 'peer', WGKEY, 'allowed-ips', '10.8.0.7/32,10.0.0.0/8'],
        ['wg', 'set', 'wg0', 'peer', WGKEY, 'endpoint', '1.2.3.4:5'],
        ['wg', 'set', 'wg0', 'peer', 'AAA=', 'remove'],
        ['wg', 'set', 'wg0', 'peer', WGKEY, 'remove', 'extra'],
        ['wg', 'set', 'wg0', 'listen-port', '1'],
      ];
      for (const argv of malos) {
        expect((await runHelper(argv)).code, argv.join(' ')).toBe(64);
      }
    });
  });

  describe('ámbito configurable (root-owned, no por el agente)', () => {
    const scope = {
      KRAKENOS_FW_CHAIN: 'MYCHAIN',
      KRAKENOS_TC_IFACE: 'enp3s0',
      KRAKENOS_WG_IFACE: 'wg9',
    };

    it('permite el ámbito configurado y rechaza el por defecto', async () => {
      expect((await runHelper(['iptables', '-F', 'MYCHAIN'], scope)).code).toBe(0);
      expect((await runHelper(['iptables', '-A', 'FORWARD', '-j', 'MYCHAIN'], scope)).code).toBe(0);
      expect((await runHelper(['tc', 'qdisc', 'del', 'dev', 'enp3s0', 'root'], scope)).code).toBe(
        0,
      );
      expect((await runHelper(['wg', 'show', 'wg9', 'public-key'], scope)).code).toBe(0);

      // Con un ámbito a medida, los defaults dejan de estar permitidos.
      expect((await runHelper(['iptables', '-F', 'KRAKENOS'], scope)).code).toBe(64);
      expect((await runHelper(['tc', 'qdisc', 'del', 'dev', 'eth0', 'root'], scope)).code).toBe(64);
      expect((await runHelper(['wg', 'show', 'wg0', 'public-key'], scope)).code).toBe(64);
    });
  });
});

describe('krakenos-helper lista cerrada de argumentos', () => {
  it('rechaza opciones que cargan código o cambian de tabla', async () => {
    const malos: string[][] = [
      ['iptables', '-A', 'KRAKENOS', '-M', '/tmp/x', '-j', 'DROP'],
      ['iptables', '-A', 'KRAKENOS', '--modprobe=/tmp/x', '-j', 'DROP'],
      ['iptables', '-A', 'KRAKENOS', '-tnat', '-j', 'DROP'],
      ['iptables', '-A', 'KRAKENOS', '--table=nat', '-j', 'DROP'],
      ['iptables', '-A', 'KRAKENOS', '--tab', 'nat', '-j', 'DROP'],
      ['iptables', '-A', 'KRAKENOS', '-m', 'osf', '-j', 'DROP'],
      ['iptables', '-A', 'KRAKENOS', '-j', 'LOG'],
      ['tc', 'filter', 'add', 'dev', 'eth0', 'bpf', 'obj', '/tmp/x.o'],
      ['tc', 'filter', 'add', 'dev', 'eth0', 'u32', 'action', 'mirred'],
      ['tc', '-b', '/tmp/f', 'qdisc', 'add', 'dev', 'eth0'],
      ['tc', 'qdisc', 'add', 'dev', 'eth0', 'root', '-batch', '/tmp/f'],
      ['tc', 'filter', 'add', 'dev', 'eth0', 'object-file', '/tmp/x.o'],
      ['tc', 'qdisc', 'add', 'dev', 'eth0', 'exec', '/tmp/x'],
      ['tc', 'qdisc', 'add', 'dev', 'eth0', '-force'],
    ];
    for (const argv of malos) {
      expect((await runHelper(argv)).code, argv.join(' ')).toBe(64);
    }
  });

  it('acepta todo lo que emiten los constructores', async () => {
    const reglas: FirewallRule[] = [];
    for (const protocol of ['tcp', 'udp', 'any'] as const) {
      for (const action of ['allow', 'block'] as const) {
        for (const extra of [
          { source: null, destination: null, port: null },
          { source: '192.168.1.10', destination: null, port: 443 },
          { source: '192.168.1.0/24', destination: '10.0.0.5', port: 22 },
        ]) {
          reglas.push({
            id: `r_${protocol}-${action}`,
            name: 'x',
            action,
            protocol,
            enabled: true,
            priority: 1,
            ...extra,
          } as FirewallRule);
        }
      }
    }
    const ipt = [
      iptablesNewChainArgs('KRAKENOS'),
      iptablesFlushArgs('KRAKENOS'),
      iptablesCheckLinkArgs('KRAKENOS'),
      iptablesLinkArgs('KRAKENOS'),
      ...reglas.flatMap((r) => iptablesAppendArgsForRule('KRAKENOS', r)),
    ];
    const tc = [
      tcQdiscDelRootArgs('eth0'),
      tcQdiscAddRootArgs('eth0', 9999),
      tcRootClassArgs('eth0', 100000),
      tcLeafClassArgs('eth0', 10, 5000, 4),
      tcFilterIpArgs('eth0', 4, '192.168.1.20', 10),
      tcFilterIpArgs('eth0', 1, '192.168.1.0/24', 11),
    ];
    expect(ipt.length).toBeGreaterThanOrEqual(8);
    expect(tc.length).toBeGreaterThanOrEqual(4);
    // Los constructores anteponen el binario (`iptables`/`tc`): es el argv del helper.
    for (const argv of [...ipt, ...tc]) {
      expect((await runHelper(argv)).code, argv.join(' ')).toBe(0);
    }
  });
});

// El helper corre como root: no puede heredar el PATH de quien lo invoca.
describe('krakenos-helper: PATH de root', () => {
  const SEGURO = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';

  it('el shebang es /bin/bash (no `env`, que resolvería bash por PATH)', () => {
    expect(readFileSync(SCRIPT, 'utf8').split('\n')[0]).toBe('#!/bin/bash');
  });

  it('fija PATH antes de la primera orden externa', () => {
    const lineas = readFileSync(SCRIPT, 'utf8').split('\n');
    const iPath = lineas.findIndex((l) => l.includes(`PATH="${SEGURO}"`));
    const iSet = lineas.findIndex((l) => l.startsWith('set -euo pipefail'));
    expect(iPath).toBeGreaterThan(0);
    expect(iPath).toBeLessThan(iSet);
  });

  // No se puede correr como root en el test: se verifica la estructura del script.
  describe('siendo root (`$EUID -eq 0`) descarta TODO el entorno KRAKENOS_*', () => {
    const REGLA = 'for _v in $(compgen -v KRAKENOS_); do unset "$_v"; done';
    const codigo = () =>
      readFileSync(SCRIPT, 'utf8')
        .split('\n')
        .map((texto, i) => ({ texto, n: i + 1 }))
        .filter((l) => /^\s*[^#\s]/.test(l.texto));

    it('hay una regla general (no una lista de nombres), dentro de `if [ "$EUID" -eq 0 ]`', () => {
      const c = codigo();
      const i = c.findIndex((l) => l.texto.trim() === REGLA);
      expect(i).toBeGreaterThan(0);
      expect(c[i - 1]?.texto).toBe('if [ "$EUID" -eq 0 ]; then');
      expect(c[i + 1]?.texto).toBe('fi');
    });

    it('ninguna variable KRAKENOS_ se lee ANTES de esa regla (ni siquiera la de pruebas)', () => {
      const c = codigo();
      const i = c.findIndex((l) => l.texto.trim() === REGLA);
      expect(i).toBeGreaterThan(0);
      const antes = c.slice(0, i).filter((l) => l.texto.includes('KRAKENOS_'));
      expect(antes).toEqual([]);
    });
  });

  it('un `wg` falso al frente del PATH del llamante NO se ejecuta (sin la variable de pruebas)', async () => {
    const marca = join(binDir, 'ejecutado');
    const falso = mkdtempSync(join(tmpdir(), 'kraken-helper-falso-'));
    const wg = join(falso, 'wg');
    writeFileSync(wg, `#!/bin/sh\ntouch ${marca}\nexit 0\n`);
    chmodSync(wg, 0o755);
    await new Promise<void>((resolve) => {
      execFile(
        'bash',
        [SCRIPT, 'wg', 'show', 'wg0', 'public-key'],
        { env: { PATH: `${falso}:${process.env.PATH}`, KRAKENOS_HELPER_CONF: '/dev/null/none' } },
        () => resolve(),
      );
    });
    rmSync(falso, { recursive: true, force: true });
    expect(existsSync(marca)).toBe(false);
  });
});

describe('krakenos.sudoers.example', () => {
  const EJEMPLO = fileURLToPath(new URL('../../scripts/krakenos.sudoers.example', import.meta.url));

  it('fija secure_path para el helper y sigue siendo sudoers válido', () => {
    const txt = readFileSync(EJEMPLO, 'utf8');
    expect(txt).toContain(
      'Defaults!/usr/local/bin/krakenos-helper secure_path="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"',
    );
    const v = spawnSync('visudo', ['-cf', EJEMPLO], { encoding: 'utf8' });
    // Sin visudo en el equipo (p. ej. Windows) solo se comprueba el texto.
    if (!v.error) expect(v.status, v.stdout + v.stderr).toBe(0);
  });
});
