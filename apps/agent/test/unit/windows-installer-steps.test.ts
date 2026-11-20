import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
// prettier-ignore
// @ts-expect-error — script de utilidad en JS puro (fuera del tsconfig del agente).
import { setKey } from '../../../../scripts/package/launchers/first-run.mjs';
// prettier-ignore
// @ts-expect-error — script de utilidad en JS puro (fuera del tsconfig del agente).
import { installService, pickPort, prepareDataDir, runInstall, stopService, virtualAccountSid, waitHealthy, withXmlPort } from '../../../../packaging/windows/installer/steps.mjs';
// prettier-ignore
// @ts-expect-error — script de utilidad en JS puro (fuera del tsconfig del agente).
import { msg } from '../../../../packaging/windows/installer/mensajes.mjs';

/** Pasos del instalador de Windows con `run`/`fs` inyectados: lo que manda cada comando, en orden. */

const DATOS = join('C:', 'ProgramData', 'KrakenOS');
const SID = 'S-1-5-80-1-2-3-4-5';
const SYSTEM = '*S-1-5-18';
const ADMINS = '*S-1-5-32-544';

type Ev = string;
function fakeRun(
  events: Ev[],
  codes: Record<string, number> = {},
  stdouts: Record<string, string> = {},
) {
  return async (cmd: string, args: string[]) => {
    const linea = [cmd, ...args].join(' ');
    events.push(linea);
    const clave = Object.keys(codes).find((k) => linea.includes(k));
    const salida = Object.keys(stdouts).find((k) => linea.includes(k));
    return {
      code: clave ? (codes[clave] as number) : 0,
      stdout: salida ? (stdouts[salida] as string) : '',
    };
  };
}

interface Nodo {
  kind: 'dir' | 'link' | 'file';
  entries?: string[];
  text?: string;
}
function fakeFs(events: Ev[], nodos: Record<string, Nodo> = {}) {
  const enoent = () => Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  return {
    lstat: async (p: string) => {
      const n = nodos[p];
      if (!n) throw enoent();
      return { isSymbolicLink: () => n.kind === 'link', isDirectory: () => n.kind === 'dir' };
    },
    readdir: async (p: string) => nodos[p]?.entries ?? [],
    mkdir: async (p: string, o?: { recursive?: boolean }) => {
      events.push(`mkdir${o?.recursive ? ' -p' : ''} ${p}`);
      if (!o?.recursive && nodos[p]) throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' });
      nodos[p] = { kind: 'dir', entries: [] };
    },
    rmdir: async (p: string) => {
      events.push(`rmdir ${p}`);
      delete nodos[p];
    },
    readFile: async (p: string) => {
      const n = nodos[p];
      if (n?.kind !== 'file') throw enoent();
      return n.text as string;
    },
    writeFile: async (p: string, t: string) => {
      events.push(`write ${p}`);
      nodos[p] = { kind: 'file', text: t };
    },
  };
}

describe('prepareDataDir', () => {
  it('pone la ACL en la raíz (sin herencia, SIDs, sin /T) ANTES de crear keys\\', async () => {
    const ev: Ev[] = [];
    await prepareDataDir({ dataDir: DATOS, serviceSid: SID, run: fakeRun(ev), fs: fakeFs(ev) });
    const i = (s: string) => ev.findIndex((l) => l.includes(s));
    expect(ev[i('/inheritance:r')]).toBe(`icacls ${DATOS} /inheritance:r`);
    expect(i('/inheritance:r')).toBeLessThan(i('/grant:r'));
    expect(ev[i('/grant:r')]).toBe(
      `icacls ${DATOS} /grant:r ${SYSTEM}:(OI)(CI)F ${ADMINS}:(OI)(CI)F *${SID}:(OI)(CI)M`,
    );
    expect(i('/grant:r')).toBeLessThan(ev.indexOf(`mkdir -p ${join(DATOS, 'keys')}`));
    expect(ev.filter((l) => l.startsWith('icacls')).every((l) => !/\/T\b/.test(l))).toBe(true);
    expect(ev.join('\n')).not.toMatch(/Users|S-1-5-32-545|Everyone|S-1-1-0/);
  });

  it('ca\\ queda solo para SYSTEM y Administradores', async () => {
    const ev: Ev[] = [];
    await prepareDataDir({ dataDir: DATOS, serviceSid: SID, run: fakeRun(ev), fs: fakeFs(ev) });
    const ca = join(DATOS, 'ca');
    expect(ev).toContain(`icacls ${ca} /inheritance:r`);
    const grant = ev.find((l) => l.startsWith(`icacls ${ca} /grant:r`)) as string;
    expect(grant).toBe(`icacls ${ca} /grant:r ${SYSTEM}:(OI)(CI)F ${ADMINS}:(OI)(CI)F`);
    expect(grant).not.toContain(SID);
  });

  it('tls\\ da al servicio solo lectura y ejecución', async () => {
    const ev: Ev[] = [];
    await prepareDataDir({ dataDir: DATOS, serviceSid: SID, run: fakeRun(ev), fs: fakeFs(ev) });
    const tls = join(DATOS, 'tls');
    expect(ev.find((l) => l.startsWith(`icacls ${tls} /grant:r`))).toBe(
      `icacls ${tls} /grant:r ${SYSTEM}:(OI)(CI)F ${ADMINS}:(OI)(CI)F *${SID}:(OI)(CI)RX`,
    );
  });

  it('deja la marca en HKLM justo tras crear la carpeta, antes de la ACL (un fallo a medias es reintentable)', async () => {
    const ev: Ev[] = [];
    await prepareDataDir({ dataDir: DATOS, serviceSid: SID, run: fakeRun(ev), fs: fakeFs(ev) });
    const marca = ev.findIndex((l) => l.startsWith('reg.exe add'));
    expect(marca).toBeGreaterThan(ev.indexOf(`mkdir ${DATOS}`));
    expect(marca).toBeLessThan(ev.findIndex((l) => l.includes('/inheritance:r')));
    expect(ev[marca]).toContain('HKLM\\SOFTWARE\\KrakenOS');
    expect(ev[marca]).toContain(DATOS);
  });

  it('lanza si la carpeta es un enlace o junction, sin tocar nada', async () => {
    const ev: Ev[] = [];
    const fs = fakeFs(ev, { [DATOS]: { kind: 'link' } });
    await expect(
      prepareDataDir({ dataDir: DATOS, serviceSid: SID, run: fakeRun(ev), fs }),
    ).rejects.toThrow(/enlace/);
    expect(ev).toEqual([]);
  });

  it('lanza nombrando la carpeta si existe con contenido y no es de un despliegue previo', async () => {
    const ev: Ev[] = [];
    const fs = fakeFs(ev, { [DATOS]: { kind: 'dir', entries: ['robado.txt'] } });
    // reg query devuelve 1: sin marca en HKLM.
    const run = fakeRun(ev, { 'reg.exe query': 1 });
    await expect(prepareDataDir({ dataDir: DATOS, serviceSid: SID, run, fs })).rejects.toThrow(
      DATOS,
    );
    expect(ev.some((l) => l.startsWith('icacls'))).toBe(false);
  });

  it('si existe vacía y sin marca, la rehace (la creó otro: sería su dueño) con mkdir sin recursión', async () => {
    const ev: Ev[] = [];
    const fs = fakeFs(ev, { [DATOS]: { kind: 'dir', entries: [] } });
    const run = fakeRun(ev, { 'reg.exe query': 1 });
    await prepareDataDir({ dataDir: DATOS, serviceSid: SID, run, fs });
    expect(ev.indexOf(`rmdir ${DATOS}`)).toBeLessThan(ev.indexOf(`mkdir ${DATOS}`));
    expect(ev.indexOf(`mkdir ${DATOS}`)).toBeLessThan(
      ev.findIndex((l) => l.includes('/inheritance:r')),
    );
  });

  it('si existe con contenido y la marca apunta a ella (actualización), conserva y rehace la ACL', async () => {
    const ev: Ev[] = [];
    const fs = fakeFs(ev, { [DATOS]: { kind: 'dir', entries: ['.env', 'keys'] } });
    const run = fakeRun(ev, {}, { 'reg.exe query': `    DataDir    REG_SZ    ${DATOS}\r\n` });
    await prepareDataDir({ dataDir: DATOS, serviceSid: SID, run, fs });
    expect(ev.some((l) => l.startsWith('rmdir'))).toBe(false);
    expect(ev).toContain(`icacls ${DATOS} /inheritance:r`);
  });

  it('un icacls que falla aborta con el comando en el mensaje', async () => {
    const ev: Ev[] = [];
    await expect(
      prepareDataDir({
        dataDir: DATOS,
        serviceSid: SID,
        run: fakeRun(ev, { '/grant:r': 5 }),
        fs: fakeFs(ev),
      }),
    ).rejects.toThrow(/icacls/);
    expect(ev.some((l) => l.includes('keys'))).toBe(false);
  });
});

describe('virtualAccountSid', () => {
  it('da un SID S-1-5-80 de cinco subautoridades, estable y sin distinguir mayúsculas', () => {
    const a = virtualAccountSid('KrakenOS');
    expect(a).toMatch(/^S-1-5-80(-\d+){5}$/);
    expect(virtualAccountSid('krakenos')).toBe(a);
    expect(virtualAccountSid('Otro')).not.toBe(a);
  });
});

describe('pickPort', () => {
  it('devuelve el preferido si está libre', async () => {
    expect(await pickPort(3001, async () => true)).toBe(3001);
  });
  it('si está ocupado, el siguiente libre', async () => {
    expect(await pickPort(3001, async (p: number) => p !== 3001)).toBe(3002);
    expect(await pickPort(3001, async (p: number) => p > 3003)).toBe(3004);
  });
  it('lanza si no hay ninguno libre en el margen', async () => {
    await expect(pickPort(3001, async () => false)).rejects.toThrow(/puerto/);
  });
});

describe('withXmlPort', () => {
  it('cambia solo el PORT del servicio', () => {
    const xml = '<env name="NODE_ENV" value="production"/>\n<env name="PORT" value="3001"/>\n';
    expect(withXmlPort(xml, 3002)).toBe(
      '<env name="NODE_ENV" value="production"/>\n<env name="PORT" value="3002"/>\n',
    );
  });
  it('lanza si el XML no trae PORT (no se finge)', () => {
    expect(() => withXmlPort('<service/>', 3002)).toThrow(/PORT/);
  });
});

describe('installService', () => {
  const exe = join('C:', 'Program Files', 'KrakenOS', 'service', 'KrakenOS-service.exe');

  it('instala, fija la cuenta virtual y el sidtype, y arranca, en ese orden', async () => {
    const ev: Ev[] = [];
    const run = fakeRun(ev, { 'sc.exe query': 1060 });
    await installService({ serviceExe: exe, run });
    expect(ev).toEqual([
      'sc.exe query KrakenOS',
      `${exe} install`,
      'sc.exe config KrakenOS obj= NT SERVICE\\KrakenOS',
      'sc.exe sidtype KrakenOS unrestricted',
      `${exe} start`,
    ]);
  });

  it('si el servicio ya existe (actualización) no lo reinstala pero lo arranca', async () => {
    const ev: Ev[] = [];
    await installService({ serviceExe: exe, run: fakeRun(ev) });
    expect(ev.some((l) => l.endsWith(' install'))).toBe(false);
    expect(ev).toContain(`${exe} start`);
  });

  it('un fallo de WinSW aborta con el comando en el mensaje', async () => {
    const ev: Ev[] = [];
    const run = fakeRun(ev, { 'sc.exe query': 1060, ' install': 1 });
    await expect(installService({ serviceExe: exe, run })).rejects.toThrow(/install/);
    expect(ev.some((l) => l.endsWith(' start'))).toBe(false);
  });
});

describe('stopService', () => {
  const exe = 'KrakenOS-service.exe';
  it('no hace nada si el servicio no existe', async () => {
    const ev: Ev[] = [];
    await stopService({
      serviceExe: exe,
      run: fakeRun(ev, { 'sc.exe query': 1060 }),
      sleep: async () => {},
    });
    expect(ev).toEqual(['sc.exe query KrakenOS']);
  });
  it('para y espera a que deje de estar RUNNING', async () => {
    const ev: Ev[] = [];
    let n = 0;
    const run = async (cmd: string, args: string[]) => {
      ev.push([cmd, ...args].join(' '));
      if (cmd === 'sc.exe')
        return {
          code: 0,
          stdout:
            n++ < 2 ? 'TIPO : 10  WIN32_OWN_PROCESS\nESTADO : 4  RUNNING' : 'ESTADO : 1  DETENIDO',
        };
      return { code: 0, stdout: '' };
    };
    await stopService({ serviceExe: exe, run, sleep: async () => {} });
    expect(ev[1]).toBe(`${exe} stop`);
    expect(ev.filter((l) => l.startsWith('sc.exe query')).length).toBe(3);
  });
  it('lanza si sigue RUNNING al agotar la espera', async () => {
    const run = async () => ({ code: 0, stdout: 'STATE : 4  RUNNING' });
    await expect(
      stopService({ serviceExe: exe, run, sleep: async () => {}, timeoutMs: 0 }),
    ).rejects.toThrow(/no se detuvo/);
  });
});

describe('waitHealthy', () => {
  it('reintenta hasta que responde 200', async () => {
    let n = 0;
    await waitHealthy(3001, 1000, async () => (++n < 3 ? 503 : 200), { intervalMs: 1 });
    expect(n).toBe(3);
  });
  it('trata un fallo de conexión como «aún no»', async () => {
    let n = 0;
    await waitHealthy(
      3001,
      1000,
      async () => {
        if (++n < 2) throw new Error('ECONNREFUSED');
        return 200;
      },
      { intervalMs: 1 },
    );
    expect(n).toBe(2);
  });
  it('consulta /health/ready en el puerto dado y lanza al agotar', async () => {
    const urls: string[] = [];
    await expect(
      waitHealthy(3002, 20, async (u: string) => (urls.push(u), 503), { intervalMs: 5 }),
    ).rejects.toThrow(/3002/);
    expect(urls[0]).toBe('http://127.0.0.1:3002/health/ready');
  });
});

describe('runInstall', () => {
  const INST = join('C:', 'Program Files', 'KrakenOS');
  const xmlPath = join(INST, 'service', 'KrakenOS-service.xml');

  function montar(opts: { ocupados?: number[]; envPrevio?: string; falla?: string } = {}) {
    const ev: Ev[] = [];
    const nodos: Record<string, Nodo> = {
      [xmlPath]: { kind: 'file', text: '<env name="PORT" value="3001"/>' },
    };
    if (opts.envPrevio) {
      nodos[DATOS] = { kind: 'dir', entries: ['.env'] };
      nodos[join(DATOS, '.env')] = { kind: 'file', text: opts.envPrevio };
    }
    const fs = fakeFs(ev, nodos);
    const run = fakeRun(
      ev,
      { 'sc.exe query': 1060 },
      opts.envPrevio ? { 'reg.exe query': `DataDir REG_SZ ${DATOS}` } : {},
    );
    const deps = {
      installDir: INST,
      dataDir: DATOS,
      run,
      fs,
      isFree: async (p: number) => !(opts.ocupados ?? []).includes(p),
      get: async () => 200,
      setKey,
      ensureEnv: (d: string) => {
        ev.push(`ensureEnv ${d}`);
        nodos[join(d, '.env')] ??= { kind: 'file', text: 'DRIVER_KIND=none\n' };
        if (opts.falla === 'env') throw new Error('boom');
      },
      ensureKeys: () => ev.push('ensureKeys'),
      log: () => {},
      sleep: async () => {},
    };
    return { ev, nodos, deps };
  }

  it('hace los pasos en orden: datos, .env, claves, servicio, salud', async () => {
    const { ev, deps } = montar();
    const r = await runInstall(deps);
    const i = (s: string) => ev.findIndex((l) => l.includes(s));
    expect(i('/inheritance:r')).toBeLessThan(i('ensureEnv'));
    expect(i('ensureEnv')).toBeLessThan(i('ensureKeys'));
    expect(i('ensureKeys')).toBeLessThan(i(' install'));
    expect(i(' install')).toBeLessThan(i(' start'));
    expect(r.port).toBe(3001);
  });

  it('con 3001 ocupado elige 3002 y lo escribe en .env y en el XML del servicio', async () => {
    const { nodos, deps } = montar({ ocupados: [3001] });
    const r = await runInstall(deps);
    expect(r.port).toBe(3002);
    expect(nodos[join(DATOS, '.env')]?.text).toMatch(/^PORT=3002$/m);
    expect(nodos[join(DATOS, '.env')]?.text).toMatch(/^HOST=0\.0\.0\.0$/m);
    expect(nodos[xmlPath]?.text).toContain('name="PORT" value="3002"');
  });

  it('al actualizar parte del PORT que ya tenía el .env, no de 3001', async () => {
    const { deps, nodos } = montar({ envPrevio: 'PORT=3005\n' });
    const r = await runInstall(deps);
    expect(r.port).toBe(3005);
    expect(nodos[join(DATOS, '.env')]?.text).toMatch(/^PORT=3005$/m);
  });

  it('un paso que falla se propaga y no sigue con el servicio', async () => {
    const { ev, deps } = montar({ falla: 'env' });
    await expect(runInstall(deps)).rejects.toThrow('boom');
    expect(ev.some((l) => l.includes(' install'))).toBe(false);
  });

  it('un servicio que no responde lanza al agotar la espera', async () => {
    const { deps } = montar();
    await expect(
      runInstall({ ...deps, get: async () => 503, healthTimeoutMs: 20, intervalMs: 5 }),
    ).rejects.toThrow(/3001/);
  });

  it('no escribe el token de setup en ningún mensaje', async () => {
    const lineas: string[] = [];
    const { deps } = montar();
    await runInstall({ ...deps, log: (l: string) => lineas.push(l) });
    expect(lineas.join('\n')).not.toMatch(/setup-token|setup\?token/i);
  });
});

describe('mensajes', () => {
  it('hay las mismas claves en es y en en', () => {
    expect(msg('es', 'puertoOcupado', 3001, 3002)).toContain('3002');
    expect(msg('en', 'puertoOcupado', 3001, 3002)).toContain('3002');
    expect(msg('es', 'puertoOcupado', 3001, 3002)).not.toBe(msg('en', 'puertoOcupado', 3001, 3002));
  });
});

describe('installer-hooks.nsh (servicio)', () => {
  const nsh = readFileSync(
    resolve(__dirname, '../../../../packaging/windows/installer-hooks.nsh'),
    'utf8',
  );
  const macro = (n: string) => nsh.split(`!macro ${n}`)[1]?.split('!macroend')[0] ?? '';

  it('POSTINSTALL lanza post-install.mjs install con el idioma y aborta si no sale con 0', () => {
    const m = macro('NSIS_HOOK_POSTINSTALL');
    expect(m).toMatch(/nsExec::ExecToLog .*post-install\.mjs" install --lang \$R8/);
    expect(m.slice(m.indexOf('post-install.mjs'))).toMatch(/\$\{If\} \$0 != 0[\s\S]*Abort/);
  });

  it('PREINSTALL para el servicio previo y aborta si no puede', () => {
    const m = macro('NSIS_HOOK_PREINSTALL');
    expect(m).toMatch(/post-install\.mjs" stop/);
    expect(m.slice(m.indexOf('post-install.mjs'))).toMatch(/\$\{If\} \$0 != 0[\s\S]*Abort/);
  });

  it('ningún hook escribe el token de setup en el log', () => {
    expect(nsh).not.toMatch(/DetailPrint[^\n]*(token|TOKEN)/);
  });
});
