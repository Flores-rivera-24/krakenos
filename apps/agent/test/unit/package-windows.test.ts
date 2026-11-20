import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
// prettier-ignore
// @ts-expect-error — script de utilidad en JS puro (fuera del tsconfig del agente).
import { buildTauriConfig, installerFileName } from '../../../../scripts/package/windows-installer.mjs';

/** El instalador de Windows (NSIS por el bundler de Tauri): la parte pura. */

const ROOT = resolve(__dirname, '../../../..');
const opts = {
  version: '0.2.0',
  payloadDir: 'C:/ruta/out/krakenos-0.2.0-win-x64',
  hooksPath: 'C:/ruta/packaging/windows/installer-hooks.nsh',
};

describe('buildTauriConfig', () => {
  const c = buildTauriConfig(opts);

  it('activa el bundler solo para NSIS, por equipo', () => {
    expect(c.bundle.active).toBe(true);
    expect(c.bundle.targets).toEqual(['nsis']);
    expect(c.bundle.windows.nsis.installMode).toBe('perMachine');
  });

  it('lleva el paquete como resources en la raíz de la instalación', () => {
    expect(c.bundle.resources).toEqual({ [`${opts.payloadDir}/`]: './' });
  });

  it('apunta los hooks al fichero dado y fija los idiomas', () => {
    expect(c.bundle.windows.nsis.installerHooks).toBe(opts.hooksPath);
    expect(c.bundle.windows.nsis.languages).toEqual(['Spanish', 'English']);
    expect(c.bundle.windows.nsis.displayLanguageSelector).toBe(false);
  });

  it('usa la versión dada', () => {
    expect(c.version).toBe('0.2.0');
  });

  it('no firma (decisión del dueño: sin firma de código)', () => {
    const texto = JSON.stringify(c);
    expect(texto).not.toMatch(/signCommand|certificateThumbprint/);
  });
});

describe('installerFileName', () => {
  it('sigue el patrón KrakenOS-Setup-<v>-x64.exe', () => {
    expect(installerFileName('0.2.0')).toBe('KrakenOS-Setup-0.2.0-x64.exe');
  });
});

describe('tauri.conf.json base', () => {
  const conf = JSON.parse(
    readFileSync(resolve(ROOT, 'apps/window/src-tauri/tauri.conf.json'), 'utf8'),
  );
  it('no activa el bundler ni el IPC global (el override lo hace solo en el build del instalador)', () => {
    expect(conf.bundle.active).toBe(false);
    expect(conf.app.withGlobalTauri).toBe(false);
  });
});

describe('installer-hooks.nsh', () => {
  const nsh = readFileSync(resolve(ROOT, 'packaging/windows/installer-hooks.nsh'), 'utf8');
  const macro = (n: string) => nsh.split(`!macro ${n}`)[1]?.split('!macroend')[0] ?? '';

  it('las cuatro macros existen', () => {
    for (const m of ['PREINSTALL', 'POSTINSTALL', 'PREUNINSTALL', 'POSTUNINSTALL'])
      expect(macro(`NSIS_HOOK_${m}`), m).not.toBe('');
  });

  it('POSTINSTALL aborta con cualquier resultado que no sea un 0 numérico', () => {
    const m = macro('NSIS_HOOK_POSTINSTALL');
    expect(m).toContain('ClearErrors');
    expect(m).toMatch(/\$\{If\} \$\{Errors\}/); // ExecWait que no se lanzó deja `error` en $0
    expect(m).toMatch(/\$\{OrIf\} \$0 != 0/); // `!=` es texto; `<>` leería «error» como 0
    expect(m).not.toContain('<>');
    expect(m).toContain('Abort');
  });

  it('PREINSTALL exige Program Files con separador final y rechaza ..', () => {
    const m = macro('NSIS_HOOK_PREINSTALL');
    expect(m).toContain('StrCpy $1 "$PROGRAMFILES64\\"');
    expect(m).toContain('".."');
    expect(m).toContain('Abort');
    expect(m).not.toMatch(/StrCmpS/); // sin distinguir mayúsculas
  });
});
