import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Tests del instalador de un comando (US-216) en modo `--dry-run`: el plan se
 * imprime sin mutar el sistema (cada mutación sale como `dry-run$ …`), así que
 * aquí se verifica el CONTRATO del script — orden de pasos, flags, honestidad
 * del uninstall y las comprobaciones de plataforma — sin root ni red.
 * La instalación real se verifica en CI (job installer-smoke) y en el
 * despliegue del usuario (checklist US-86).
 */
const SCRIPT = fileURLToPath(new URL('../../../../scripts/install.sh', import.meta.url));

/** Plataforma soportada simulada; MIN_* a 1 para que RAM/disco reales pasen. */
const SUPPORTED_ENV = {
  KRAKENOS_OS_ID: 'debian',
  KRAKENOS_ARCH: 'x86_64',
  KRAKENOS_MIN_RAM_MB: '1',
  KRAKENOS_MIN_DISK_MB: '1',
};

function runInstaller(
  args: string[],
  env: NodeJS.ProcessEnv = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise) => {
    execFile(
      'bash',
      [SCRIPT, ...args],
      { env: { ...process.env, ...SUPPORTED_ENV, ...env } },
      (err, stdout, stderr) => {
        const code =
          err && typeof (err as { code?: unknown }).code === 'number'
            ? (err as { code: number }).code
            : 0;
        resolvePromise({ code, stdout, stderr });
      },
    );
  });
}

describe('install.sh --dry-run (US-216)', () => {
  it('imprime el plan completo en orden: pnpm pinneado → clone → keys → migrate → build → systemd', async () => {
    const { code, stdout } = await runInstaller(['--dry-run', '--yes', '--dir', '/tmp/kraken-x']);
    expect(code).toBe(0);
    const order = [
      'corepack prepare pnpm@9.12.0 --activate', // pinneado, patrón AUD-27
      'git clone',
      'gen-keys.sh',
      'pnpm install --frozen-lockfile',
      'prisma migrate deploy',
      'pnpm build',
      'systemctl enable --now krakenos',
    ];
    let last = -1;
    for (const step of order) {
      const at = stdout.indexOf(step);
      expect(at, `falta el paso «${step}» en el plan`).toBeGreaterThan(last);
      last = at;
    }
    // Nada se ejecuta de verdad: toda mutación va marcada como dry-run.
    expect(stdout).toContain('dry-run$');
  });

  it('--no-service omite systemd y explica el arranque manual', async () => {
    const { code, stdout } = await runInstaller([
      '--dry-run',
      '--yes',
      '--no-service',
      '--dir',
      '/tmp/kraken-x',
    ]);
    expect(code).toBe(0);
    expect(stdout).not.toContain('systemctl enable');
    expect(stdout).not.toContain('useradd');
    expect(stdout).toContain('Arranque manual');
  });

  it('--from-local copia el árbol local (sin node_modules) en vez de clonar', async () => {
    const { code, stdout } = await runInstaller([
      '--dry-run',
      '--yes',
      '--no-service',
      '--dir',
      '/tmp/kraken-x',
      '--from-local',
      process.cwd(),
    ]);
    expect(code).toBe(0);
    expect(stdout).toContain('--exclude=node_modules');
    // La copia jamás hereda secretos ni estado del árbol de origen.
    for (const secret of ['--exclude=.env', '--exclude=keys', '--exclude=data']) {
      expect(stdout).toContain(secret);
    }
    expect(stdout).not.toContain('git clone');
  });

  it('--dir se respeta en todo el plan', async () => {
    const { stdout } = await runInstaller(['--dry-run', '--yes', '--dir', '/srv/mi-kraken']);
    expect(stdout).toContain('→ /srv/mi-kraken');
    expect(stdout).toContain('/srv/mi-kraken/apps/agent');
  });

  it('rechaza un SO no soportado con un mensaje honesto (no un stacktrace)', async () => {
    const { code, stderr } = await runInstaller(['--dry-run'], { KRAKENOS_OS_ID: 'fedora' });
    expect(code).toBe(1);
    expect(stderr).toContain('SO no soportado');
    expect(stderr).toContain('instalación manual');
  });

  it('rechaza una arquitectura de 32 bits', async () => {
    const { code, stderr } = await runInstaller(['--dry-run'], { KRAKENOS_ARCH: 'armv7l' });
    expect(code).toBe(1);
    expect(stderr).toContain('arquitectura no soportada');
  });

  it('rechaza RAM insuficiente con la cota configurada', async () => {
    const { code, stderr } = await runInstaller(['--dry-run'], {
      KRAKENOS_MIN_RAM_MB: '99999999',
    });
    expect(code).toBe(1);
    expect(stderr).toContain('RAM insuficiente');
  });

  it('--uninstall sin --purge conserva y ENUMERA los datos (DB, keys, data)', async () => {
    const { code, stdout } = await runInstaller([
      '--dry-run',
      '--yes',
      '--uninstall',
      '--dir',
      '/tmp/kraken-x',
    ]);
    expect(code).toBe(0);
    expect(stdout).toContain('systemctl disable --now krakenos');
    expect(stdout).toContain('Se conserva /tmp/kraken-x');
    expect(stdout).toContain('prisma/*.db');
    expect(stdout).toContain('keys/');
    expect(stdout).toContain('data/');
    // Sin purge, jamás aparece un rm -rf del directorio como acción.
    expect(stdout).not.toContain('dry-run$ rm -rf /tmp/kraken-x');
    // Y se retira la regla sudoers que el instalador puso (no deja residuos).
    expect(stdout).toContain('/etc/sudoers.d/krakenos-update');
  });

  it('--update reusa el orquestador de US-190 (update-runner one-shot)', async () => {
    // Sobre este mismo repo (tiene .git), el plan debe delegar en update-runner.
    const { code, stdout } = await runInstaller([
      '--dry-run',
      '--yes',
      '--update',
      '--dir',
      fileURLToPath(new URL('../../../..', import.meta.url)),
    ]);
    expect(code).toBe(0);
    expect(stdout).toContain('node dist/update-runner.js');
    expect(stdout).toContain('rollback');
  });

  // US-232 (AUD3-23): en `curl | sudo bash` no hay TTY, así que el viejo `confirm()`
  // respondía «no» SIEMPRE y la instalación se quedaba sin cámaras ni VPN en
  // silencio. Ahora los extras van por bandera y lo omitido se dice en voz alta.
  it('sin banderas de extras: no instala ninguno y AVISA de lo que queda desactivado', async () => {
    const { code, stdout } = await runInstaller(['--dry-run', '--yes', '--dir', '/tmp/kraken-x']);
    expect(code).toBe(0);
    // Ninguna instalación de extras en el plan (el resumen final SÍ los nombra,
    // que es justo lo que se quiere: avisar de lo que falta).
    expect(stdout).not.toContain('install -y -qq ffmpeg');
    expect(stdout).not.toContain('krakenos-helper');
    expect(stdout).not.toContain('pnpm add');
    expect(stdout).toContain('Qué quedó FUERA');
    for (const missing of ['--with-helper', '--with-ffmpeg', '--with-deps', '--with-all']) {
      expect(stdout, `el resumen debe señalar ${missing}`).toContain(missing);
    }
  });

  it('--with-all instala los tres extras y no hay nada que avisar', async () => {
    const { code, stdout } = await runInstaller([
      '--dry-run',
      '--yes',
      '--with-all',
      '--dir',
      '/tmp/kraken-x',
    ]);
    expect(code).toBe(0);
    expect(stdout).toContain('krakenos-helper');
    expect(stdout).toContain('ffmpeg');
    expect(stdout).toContain('pnpm add node-ssh mqtt net-snmp ws');
    // El manifiesto que el actualizador reinstala tras cada update (AUD3-22).
    expect(stdout).toContain('extra-deps.json');
    expect(stdout).not.toContain('Qué quedó FUERA');
  });

  it('cada extra se activa por separado', async () => {
    const only = async (flag: string) =>
      (await runInstaller(['--dry-run', '--yes', flag, '--dir', '/tmp/kraken-x'])).stdout;
    const ffmpeg = await only('--with-ffmpeg');
    expect(ffmpeg).toContain('ffmpeg');
    expect(ffmpeg).not.toContain('krakenos-helper');
    const helper = await only('--with-helper');
    expect(helper).toContain('krakenos-helper');
    expect(helper).not.toContain('install -y -qq ffmpeg');
  });

  it('endurece los permisos de los secretos (AUD3-06: .env y la DB quedaban a 0644)', async () => {
    const { stdout } = await runInstaller(['--dry-run', '--yes', '--dir', '/tmp/kraken-x']);
    expect(stdout).toContain('chmod 600 /tmp/kraken-x/apps/agent/.env');
    expect(stdout).toMatch(/chmod 600 .*keys/);
    expect(stdout).toMatch(/chmod 600 .*\.db/);
  });

  it('instala la regla sudoers de restart VALIDADA (sin ella el update se revierte siempre)', async () => {
    const { stdout } = await runInstaller(['--dry-run', '--yes', '--dir', '/tmp/kraken-x']);
    expect(stdout).toContain('/etc/sudoers.d/krakenos-update');
    // Nunca se instala sin validar: un sudoers roto rompe `sudo` en toda la máquina.
    expect(stdout).toContain('visudo -cf');
  });

  it('la unidad systemd lleva KillMode=process (sin él el actualizador se suicida)', async () => {
    // En dry-run el unit no se escribe, pero el plan sí nombra el fichero; el
    // contenido se verifica sobre la plantilla versionada.
    const { stdout } = await runInstaller(['--dry-run', '--yes', '--dir', '/tmp/kraken-x']);
    expect(stdout).toContain('/etc/systemd/system/krakenos.service');
    const unit = readFileSync(
      fileURLToPath(new URL('../../scripts/krakenos.service.example', import.meta.url)),
      'utf8',
    );
    expect(unit).toMatch(/^KillMode=process$/m);
  });

  it('el pipe de NodeSource corre con pipefail (si no, degrada a Node 18 en silencio)', () => {
    const script = readFileSync(SCRIPT, 'utf8');
    const nodesource = script.split('\n').find((l) => l.includes('deb.nodesource.com'));
    expect(nodesource).toBeDefined();
    expect(nodesource).toContain('set -o pipefail');
  });

  it('rechaza rutas con metacaracteres o relativas (se interpolan en bash -c)', async () => {
    for (const dir of ["/tmp/kraken'x", '/tmp/kraken x', 'relativa/kraken', '/tmp/kraken$HOME']) {
      const { code, stderr } = await runInstaller(['--dry-run', '--yes', '--dir', dir]);
      expect(code, `debería rechazar «${dir}»`).toBe(1);
      expect(stderr).toContain('ruta no válida');
    }
  });

  it('una opción desconocida falla con ayuda, no ejecuta nada', async () => {
    const { code, stderr } = await runInstaller(['--dry-run', '--frobnicar']);
    expect(code).toBe(1);
    expect(stderr).toContain('opción desconocida');
  });
});
