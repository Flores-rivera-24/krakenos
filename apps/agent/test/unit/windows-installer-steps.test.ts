import { X509Certificate } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensureLocalCa } from '../../src/crypto/local-ca.js';
// prettier-ignore
// @ts-expect-error — script de utilidad en JS puro (fuera del tsconfig del agente).
import { setKey } from '../../../../scripts/package/launchers/first-run.mjs';
// prettier-ignore
// @ts-expect-error — script de utilidad en JS puro (fuera del tsconfig del agente).
import { activeNetwork, grantServiceAccess, installService, localHostname, offerPrivateNetwork, openFirewall, pickPort, prepareDataDir, readSetupToken, registerRenewalTask, runInstall, setupTls, showDialog, stopService, uninstallAll, virtualAccountSid, waitHealthy, withXmlPort, writeWindowJson } from '../../../../packaging/windows/installer/steps.mjs';
// prettier-ignore
// @ts-expect-error — script de utilidad en JS puro (fuera del tsconfig del agente).
import { renew } from '../../../../packaging/windows/installer/renew-tls.mjs';
// prettier-ignore
// @ts-expect-error — script de utilidad en JS puro (fuera del tsconfig del agente).
import { msg } from '../../../../packaging/windows/installer/mensajes.mjs';

/** Pasos del instalador de Windows con `run`/`fs` inyectados: lo que manda cada comando, en orden. */

const DATOS = join('C:', 'ProgramData', 'KrakenOS');
const SID = 'S-1-5-80-1-2-3-4-5';
const ADMINS = '*S-1-5-32-544';

type Ev = string;
/** Entorno con el que se lanzó cada comando que lo pidió (tercer argumento de `run`). */
const ENVS: Record<string, string>[] = [];
function fakeRun(
  events: Ev[],
  codes: Record<string, number> = {},
  stdouts: Record<string, string> = {},
  // `abierta`: la raíz y las subcarpetas parten heredando Users (carpeta nueva de ProgramData) y solo se
  // corrigen con el cambio atómico; `dueno`: dueño que lee antes de que se fije Administradores.
  opt: { abierta?: boolean; dueno?: string } = {},
) {
  const abierta = opt.abierta ?? true;
  const rehechas = new Set<string>();
  const conDueno = new Set<string>();
  const conServicio = new Map<string, string>();
  let pendiente = false; // HKLM\\SOFTWARE\\KrakenOS\\CaPendienteRotar
  return async (cmd: string, args: string[], o?: { env?: Record<string, string> }) => {
    const linea = [cmd, ...args].join(' ');
    events.push(linea);
    if (o?.env) ENVS.push(o.env);
    const sidServicio = /\*(S-1-5-80[-\d]+):/.exec(linea)?.[1];
    if (cmd === 'icacls' && args[1] === '/grant:r' && sidServicio)
      conServicio.set(args[0] as string, sidServicio);
    if (cmd === 'icacls' && args[1] === '/setowner') conDueno.add(args[0] as string);
    const rehecha = /SetAccessControl\('([^']*)'/.exec(linea)?.[1];
    if (rehecha) rehechas.add(rehecha);
    if (linea.includes('CaPendienteRotar')) {
      if (cmd === 'reg.exe' && args[0] === 'add') pendiente = true;
      if (cmd === 'reg.exe' && args[0] === 'delete') pendiente = false;
      if (cmd === 'reg.exe' && args[0] === 'query')
        return pendiente
          ? { code: 0, stdout: '    CaPendienteRotar    REG_SZ    1\r\n' }
          : { code: 1, stdout: '' };
      return { code: 0, stdout: '' };
    }
    const clave = Object.keys(codes).find((k) => linea.includes(k));
    const salida = Object.keys(stdouts).find((k) => linea.includes(k));
    // Lectura de la ACL por SID: la de un despliegue bueno (SYSTEM y Administradores, y el servicio si ya se le dio).
    let lectura = '';
    if (cmd === 'powershell.exe') {
      const dir = /GetAccessControl\('([^']*)'\)/.exec(linea)?.[1] ?? '';
      const ajeno = opt.dueno && !conDueno.has(dir) ? opt.dueno : 'S-1-5-32-544';
      lectura = [
        `OWNER:${ajeno}`,
        ...(abierta && !rehechas.has(dir)
          ? ['S-1-5-32-545|ReadAndExecute, Synchronize|Allow|True']
          : []),
        'S-1-5-18|FullControl|Allow|False',
        'S-1-5-32-544|FullControl|Allow|False',
        ...(conServicio.has(dir)
          ? [
              `${conServicio.get(dir)}|${/tls$/.test(dir) ? 'ReadAndExecute, Synchronize' : 'Modify, Synchronize'}|Allow|False`,
            ]
          : []),
      ].join('\r\n');
    }
    return {
      code: clave ? (codes[clave] as number) : 0,
      stdout: salida ? (stdouts[salida] as string) : lectura,
    };
  };
}

interface Nodo {
  kind: 'dir' | 'link' | 'file';
  entries?: string[];
  text?: string;
  /** Ruta real que resuelve `realpath` (una junction que `lstat` no ve como enlace). */
  real?: string;
}
/** Como el disco real: lo borrado deja de figurar en `readdir` de su carpeta. */
function quitarDeSuCarpeta(nodos: Record<string, Nodo>, p: string) {
  const padre = nodos[dirname(p)];
  if (padre?.entries) padre.entries = padre.entries.filter((n) => n !== basename(p));
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
    realpath: async (p: string) => nodos[p]?.real ?? p,
    mkdir: async (p: string, o?: { recursive?: boolean }) => {
      events.push(`mkdir${o?.recursive ? ' -p' : ''} ${p}`);
      if (!o?.recursive && nodos[p]) throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' });
      if (!nodos[p]) nodos[p] = { kind: 'dir', entries: [] };
    },
    rename: async (a: string, b: string) => {
      events.push(`rename ${a} ${b}`);
      nodos[b] = nodos[a] as Nodo;
      delete nodos[a];
    },
    rm: async (p: string) => {
      events.push(`rm ${p}`);
      delete nodos[p];
    },
    unlink: async (p: string) => {
      events.push(`unlink ${p}`);
      delete nodos[p];
      quitarDeSuCarpeta(nodos, p);
    },
    rmdir: async (p: string) => {
      events.push(`rmdir ${p}`);
      delete nodos[p];
      quitarDeSuCarpeta(nodos, p);
    },
    readFile: async (p: string) => {
      const n = nodos[p];
      if (n?.kind !== 'file') throw enoent();
      return n.text as string;
    },
    writeFile: async (p: string, t: string, o?: { flag?: string }) => {
      events.push(`write${o?.flag ? ` (${o.flag})` : ''} ${p}`);
      nodos[p] = { kind: 'file', text: t };
    },
  };
}

describe('prepareDataDir', () => {
  /** Línea del cambio atómico de DACL de una carpeta (un solo SetAccessControl, sin herencia). */
  const cambioAcl = (ev: Ev[], dir: string) =>
    ev.findIndex((l) => l.startsWith('powershell.exe') && l.includes(`SetAccessControl('${dir}'`));

  it('rehace la ACL de la raíz de una vez (sin /reset ni /inheritance:r), con dueño, ANTES de crear keys\\', async () => {
    const ev: Ev[] = [];
    await prepareDataDir({ dataDir: DATOS, run: fakeRun(ev), fs: fakeFs(ev) });
    const k = cambioAcl(ev, DATOS);
    expect(k).toBeGreaterThan(-1);
    const cambio = ev[k] as string;
    expect(cambio).toContain('SetAccessRuleProtection($true, $false)');
    expect(cambio).toContain("SecurityIdentifier('S-1-5-18')");
    expect(cambio).toContain("SecurityIdentifier('S-1-5-32-544')");
    expect(cambio).not.toMatch(/545|S-1-1-0|Users|Everyone/);
    // Sin PowerShell en Linux: al menos que los paréntesis del script cuadren (un `)` de menos rompió la CI).
    expect(cambio.split('(').length).toBe(cambio.split(')').length);
    // Nunca un estado heredado o vacío en medio: ni /reset ni /inheritance:r sobre la raíz.
    expect(ev).not.toContain(`icacls ${DATOS} /reset`);
    expect(ev.some((l) => l.startsWith(`icacls ${DATOS} `) && l.includes('/inheritance'))).toBe(
      false,
    );
    expect(ev[k + 1]).toBe(`icacls ${DATOS} /setowner ${ADMINS}`);
    expect(k).toBeLessThan(ev.indexOf(`mkdir -p ${join(DATOS, 'keys')}`));
    expect(ev.filter((l) => l.startsWith('icacls')).every((l) => !/\/T\b/.test(l))).toBe(true);
  });

  it('con marca y la ACL ya correcta (actualización) no toca la raíz: ni DACL, ni /reset, ni dueño', async () => {
    const ev: Ev[] = [];
    const fs = fakeFs(ev, {
      [DATOS]: { kind: 'dir', entries: ['.env'] },
      [join(DATOS, '.env')]: { kind: 'file', text: '' },
    });
    const run = fakeRun(ev, {}, { 'reg.exe query': `DataDir REG_SZ ${DATOS}` }, { abierta: false });
    await prepareDataDir({ dataDir: DATOS, run, fs });
    expect(cambioAcl(ev, DATOS)).toBe(-1);
    expect(ev.some((l) => l.startsWith(`icacls ${DATOS} `))).toBe(false);
    // Los hijos sí se reponen a lo heredado (uno a uno), pero eso es debajo de una raíz ya restringida.
    expect(ev).toContain(`icacls ${join(DATOS, '.env')} /reset /T /L`);
    expect(ev.some((l) => l.includes('/setowner') && l.includes('/T'))).toBe(false);
  });

  it('con la raíz de otro dueño la rehace, fija Administradores y se lo quita también a lo de dentro', async () => {
    const ev: Ev[] = [];
    const fs = fakeFs(ev, {
      [DATOS]: { kind: 'dir', entries: ['.env'] },
      [join(DATOS, '.env')]: { kind: 'file', text: '' },
    });
    const run = fakeRun(
      ev,
      {},
      { 'reg.exe query': `DataDir REG_SZ ${DATOS}` },
      { abierta: false, dueno: 'S-1-5-21-1-2-3-1001' },
    );
    await prepareDataDir({ dataDir: DATOS, run, fs });
    expect(cambioAcl(ev, DATOS)).toBeGreaterThan(-1);
    expect(ev).toContain(`icacls ${DATOS} /setowner ${ADMINS}`);
    expect(ev).toContain(`icacls ${join(DATOS, '.env')} /setowner ${ADMINS} /T /L`);
  });

  it('un dueño ajeno que no se deja corregir aborta sin marca', async () => {
    const ev: Ev[] = [];
    const run = fakeRun(
      ev,
      {},
      {
        [`GetAccessControl('${DATOS}')`]:
          'OWNER:S-1-5-21-1-2-3-1001\nS-1-5-18|FullControl|Allow|False\nS-1-5-32-544|FullControl|Allow|False',
      },
    );
    await expect(prepareDataDir({ dataDir: DATOS, run, fs: fakeFs(ev) })).rejects.toThrow(/dueño/);
    expect(ev.some((l) => l.startsWith('reg.exe add'))).toBe(false);
  });

  it('una carpeta previa con un enlace dentro aborta ANTES de tocar ninguna ACL', async () => {
    const ev: Ev[] = [];
    const fs = fakeFs(ev, {
      [DATOS]: { kind: 'dir', entries: ['logs'] },
      [join(DATOS, 'logs')]: { kind: 'link' },
    });
    const run = fakeRun(ev, {}, { 'reg.exe query': `DataDir REG_SZ ${DATOS}` });
    await expect(prepareDataDir({ dataDir: DATOS, run, fs })).rejects.toThrow(/enlace/);
    expect(ev.some((l) => l.startsWith('icacls') || l.includes('SetAccessControl'))).toBe(false);
  });

  it('ca\\ queda solo para SYSTEM y Administradores', async () => {
    const ev: Ev[] = [];
    await prepareDataDir({ dataDir: DATOS, run: fakeRun(ev), fs: fakeFs(ev) });
    const ca = join(DATOS, 'ca');
    const cambio = ev[cambioAcl(ev, ca)] as string;
    expect(cambio).toContain('SetAccessRuleProtection($true, $false)');
    expect(cambio).toContain("SecurityIdentifier('S-1-5-18')");
    expect(cambio).toContain("SecurityIdentifier('S-1-5-32-544')");
    expect(cambio).not.toContain('S-1-5-80');
  });

  it('la cuenta del servicio NO se concede en prepareDataDir (su SID aún no resuelve)', async () => {
    const ev: Ev[] = [];
    await prepareDataDir({ dataDir: DATOS, run: fakeRun(ev), fs: fakeFs(ev) });
    expect(ev.join('\n')).not.toContain('S-1-5-80');
  });

  it('grantServiceAccess da Modificar en los datos y solo lectura en tls\\, verificando', async () => {
    const ev: Ev[] = [];
    await grantServiceAccess({
      dataDir: DATOS,
      serviceSid: SID,
      run: fakeRun(ev, {}, {}, { abierta: false }),
    });
    const tls = join(DATOS, 'tls');
    expect(ev.filter((l) => !l.startsWith('powershell.exe'))).toEqual([
      `icacls ${DATOS} /grant:r *${SID}:(OI)(CI)M`,
      `icacls ${tls} /grant:r *${SID}:(OI)(CI)RX`,
    ]);
  });

  it('ACL restrictiva y verificada ANTES de la marca y de escribir nada dentro', async () => {
    const ev: Ev[] = [];
    await prepareDataDir({ dataDir: DATOS, run: fakeRun(ev), fs: fakeFs(ev) });
    const lectura = ev.findIndex(
      (l, i) =>
        i > cambioAcl(ev, DATOS) &&
        l.startsWith('powershell.exe') &&
        l.includes(`GetAccessControl('${DATOS}'`),
    );
    const marca = ev.findIndex((l) => l.startsWith('reg.exe add'));
    expect(ev.indexOf(`mkdir ${DATOS}`)).toBeLessThan(cambioAcl(ev, DATOS));
    expect(lectura).toBeGreaterThan(cambioAcl(ev, DATOS));
    expect(marca).toBeGreaterThan(lectura);
    expect(marca).toBeLessThan(ev.findIndex((l) => l.startsWith('mkdir -p')));
    expect(ev[marca]).toContain('HKLM\\SOFTWARE\\KrakenOS');
    expect(ev[marca]).toContain(DATOS);
  });

  const acl = (...filas: string[]) => ({
    [`GetAccessControl('${DATOS}')`]: ['OWNER:S-1-5-32-544', ...filas].join('\n'),
  });
  const bien = ['S-1-5-18|FullControl|Allow|False', 'S-1-5-32-544|FullControl|Allow|False'];

  it.each([
    ['Users (S-1-5-32-545)', 'S-1-5-32-545|ReadAndExecute, Synchronize|Allow|False'],
    ['Everyone (S-1-1-0)', 'S-1-1-0|Read|Allow|False'],
    ['un usuario cualquiera', 'S-1-5-21-1-2-3-1001|Modify|Allow|False'],
    ['el servicio, que aún no toca (el servicio va después)', `${SID}|Modify|Allow|False`],
  ])('una tercera ACE de %s aborta sin marca y sin escribir dentro', async (_n, fila) => {
    const ev: Ev[] = [];
    const run = fakeRun(ev, {}, acl(...bien, fila as string));
    await expect(prepareDataDir({ dataDir: DATOS, run, fs: fakeFs(ev) })).rejects.toThrow(
      /ACL.*(inesperada|distinta)/,
    );
    expect(ev.some((l) => l.startsWith('reg.exe add'))).toBe(false);
    expect(ev.some((l) => l.startsWith('mkdir -p'))).toBe(false);
  });

  it('una ACE heredada, una Deny o derechos de menos abortan; una salida ilegible también', async () => {
    for (const filas of [
      [bien[0], 'S-1-5-32-544|FullControl|Allow|True'],
      [bien[0], 'S-1-5-32-544|FullControl|Deny|False'],
      [bien[0], 'S-1-5-32-544|Read|Allow|False'],
      [bien[0]], // falta una
      [bien[0], 'error de PowerShell'],
    ]) {
      const ev: Ev[] = [];
      const run = fakeRun(ev, {}, acl(...(filas as string[])));
      await expect(prepareDataDir({ dataDir: DATOS, run, fs: fakeFs(ev) })).rejects.toThrow(/ACL/);
    }
  });

  it('grantServiceAccess aborta si en los datos aparece Users con el servicio', async () => {
    const ev: Ev[] = [];
    const run = fakeRun(
      ev,
      {},
      acl(...bien, `${SID}|Modify, Synchronize|Allow|False`, 'S-1-5-32-545|Read|Allow|False'),
    );
    await expect(grantServiceAccess({ dataDir: DATOS, serviceSid: SID, run })).rejects.toThrow(
      /S-1-5-32-545/,
    );
  });

  it('algo plantado en la carpeta nueva entre mkdir e icacls aborta sin marca', async () => {
    const ev: Ev[] = [];
    const fs = fakeFs(ev);
    fs.readdir = async () => ['plantado'];
    await expect(prepareDataDir({ dataDir: DATOS, run: fakeRun(ev), fs })).rejects.toThrow(DATOS);
    expect(ev.some((l) => l.startsWith('reg.exe add'))).toBe(false);
  });

  it('un enlace anidado también se rechaza', async () => {
    const ev: Ev[] = [];
    const fs = fakeFs(ev, {
      [DATOS]: { kind: 'dir', entries: ['sub'] },
      [join(DATOS, 'sub')]: { kind: 'dir', entries: ['prisma'] },
      [join(DATOS, 'sub', 'prisma')]: { kind: 'link' },
    });
    const run = fakeRun(ev, {}, { 'reg.exe query': `DataDir REG_SZ ${DATOS}` });
    await expect(prepareDataDir({ dataDir: DATOS, run, fs })).rejects.toThrow(/enlace/);
  });

  it('lanza si la carpeta es un enlace o junction, sin tocar nada', async () => {
    const ev: Ev[] = [];
    const fs = fakeFs(ev, { [DATOS]: { kind: 'link' } });
    await expect(prepareDataDir({ dataDir: DATOS, run: fakeRun(ev), fs })).rejects.toThrow(
      /enlace/,
    );
    expect(ev).toEqual([]);
  });

  it('lanza nombrando la carpeta si existe con contenido y no es de un despliegue previo', async () => {
    const ev: Ev[] = [];
    const fs = fakeFs(ev, { [DATOS]: { kind: 'dir', entries: ['robado.txt'] } });
    // reg query devuelve 1: sin marca en HKLM.
    const run = fakeRun(ev, { 'reg.exe query': 1 });
    await expect(prepareDataDir({ dataDir: DATOS, run, fs })).rejects.toThrow(DATOS);
    expect(ev.some((l) => l.startsWith('icacls'))).toBe(false);
  });

  it('si existe vacía y sin marca, la rehace (la creó otro: sería su dueño) con mkdir sin recursión', async () => {
    const ev: Ev[] = [];
    const fs = fakeFs(ev, { [DATOS]: { kind: 'dir', entries: [] } });
    const run = fakeRun(ev, { 'reg.exe query': 1 });
    await prepareDataDir({ dataDir: DATOS, run, fs });
    expect(ev.indexOf(`rmdir ${DATOS}`)).toBeLessThan(ev.indexOf(`mkdir ${DATOS}`));
    expect(ev.indexOf(`mkdir ${DATOS}`)).toBeLessThan(cambioAcl(ev, DATOS));
  });

  it('si existe con contenido y la marca apunta a ella pero la ACL está abierta, conserva y la rehace', async () => {
    const ev: Ev[] = [];
    const fs = fakeFs(ev, {
      [DATOS]: { kind: 'dir', entries: ['.env', 'keys'] },
      [join(DATOS, '.env')]: { kind: 'file', text: '' },
      [join(DATOS, 'keys')]: { kind: 'dir', entries: [] },
    });
    const run = fakeRun(ev, {}, { 'reg.exe query': `    DataDir    REG_SZ    ${DATOS}\r\n` });
    await prepareDataDir({ dataDir: DATOS, run, fs });
    expect(ev.some((l) => l.startsWith('rmdir'))).toBe(false);
    expect(cambioAcl(ev, DATOS)).toBeGreaterThan(-1);
    // El contenido previo (ya sin enlaces) vuelve a heredar de la raíz restringida.
    expect(ev).toContain(`icacls ${join(DATOS, 'keys')} /reset /T /L`);
    expect(ev.indexOf(`icacls ${join(DATOS, 'keys')} /reset /T /L`)).toBeGreaterThan(
      cambioAcl(ev, DATOS),
    );
  });

  it('ca\\ y tls\\ no entran en el reset de los hijos: ca\\ nunca hereda de la raíz (donde el servicio modifica)', async () => {
    const ev: Ev[] = [];
    const ca = join(DATOS, 'ca');
    const fs = fakeFs(ev, {
      [DATOS]: { kind: 'dir', entries: ['.env', 'ca', 'tls', 'keys'] },
      [join(DATOS, '.env')]: { kind: 'file', text: '' },
      [ca]: { kind: 'dir', entries: ['krakenos-ca-key.pem'] },
      [join(ca, 'krakenos-ca-key.pem')]: { kind: 'file', text: 'x' },
      [join(DATOS, 'tls')]: { kind: 'dir', entries: ['agent-key.pem'] },
      [join(DATOS, 'tls', 'agent-key.pem')]: { kind: 'file', text: 'x' },
      [join(DATOS, 'keys')]: { kind: 'dir', entries: [] },
    });
    const run = fakeRun(ev, {}, { 'reg.exe query': `DataDir REG_SZ ${DATOS}` });
    const r = await prepareDataDir({ dataDir: DATOS, run, fs });
    // ca\\ tenía contenido y su ACL estaba abierta: la CA pudo leerse y no se adopta.
    expect(r.caExpuesta).toBe(true);
    // Nada de `datos\*`: ese glob incluía a ca\ y la dejaba heredando hasta que se le aplicara su ACL.
    expect(ev.some((l) => l.includes(`${join(DATOS, '*')} `))).toBe(false);
    expect(ev).not.toContain(`icacls ${ca} /reset /T /L`);
    expect(ev).not.toContain(`icacls ${join(DATOS, 'tls')} /reset /T /L`);
    expect(ev).toContain(`icacls ${join(DATOS, '.env')} /reset /T /L`);
    expect(ev).toContain(`icacls ${join(DATOS, 'keys')} /reset /T /L`);
    // Su contenido hereda de ca\ solo después de que ca\ tenga su ACL cerrada.
    expect(cambioAcl(ev, ca)).toBeGreaterThan(-1);
    expect(ev.indexOf(`icacls ${join(ca, '*')} /reset /T /L`)).toBeGreaterThan(cambioAcl(ev, ca));
  });

  it('con ca\\ y tls\\ ya cerradas (o nuevas) la CA no se considera expuesta', async () => {
    const ev: Ev[] = [];
    const fs = fakeFs(ev, {
      [DATOS]: { kind: 'dir', entries: ['ca', 'tls'] },
      [join(DATOS, 'ca')]: { kind: 'dir', entries: ['krakenos-ca-key.pem'] },
      [join(DATOS, 'ca', 'krakenos-ca-key.pem')]: { kind: 'file', text: 'x' },
      [join(DATOS, 'tls')]: { kind: 'dir', entries: [] },
    });
    const run = fakeRun(ev, {}, { 'reg.exe query': `DataDir REG_SZ ${DATOS}` }, { abierta: false });
    expect((await prepareDataDir({ dataDir: DATOS, run, fs })).caExpuesta).toBe(false);
    expect(
      (await prepareDataDir({ dataDir: DATOS, run: fakeRun([]), fs: fakeFs([]) })).caExpuesta,
    ).toBe(false);
  });

  it('un icacls que falla aborta con el comando en el mensaje', async () => {
    const ev: Ev[] = [];
    await expect(
      prepareDataDir({
        dataDir: DATOS,
        run: fakeRun(ev, { '/setowner': 5 }),
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

  it('concede acceso a los datos tras configurar la cuenta y ANTES de arrancar', async () => {
    const ev: Ev[] = [];
    const run = fakeRun(ev, { 'sc.exe query': 1060 });
    await installService({
      serviceExe: exe,
      run,
      antesDeArrancar: async () => void ev.push('grant'),
    });
    expect(ev.slice(-3)).toEqual(['sc.exe sidtype KrakenOS unrestricted', 'grant', `${exe} start`]);
  });

  it('si el servicio ya existe (actualización) lo reinstala con el XML nuevo y lo arranca, conservando la cuenta', async () => {
    const ev: Ev[] = [];
    let existe = true;
    const run = async (cmd: string, args: string[]) => {
      ev.push([cmd, ...args].join(' '));
      if (cmd === exe && args[0] === 'uninstall') existe = false;
      if (cmd === exe && args[0] === 'install') existe = true;
      if (cmd === 'sc.exe' && args[0] === 'query')
        return existe ? { code: 0, stdout: 'ESTADO : 1  DETENIDO' } : { code: 1060, stdout: '' };
      return { code: 0, stdout: '' };
    };
    await installService({ serviceExe: exe, run, sleep: async () => {} });
    const i = (l: string) => ev.indexOf(l);
    expect(i(`${exe} uninstall`)).toBeGreaterThan(-1);
    expect(i(`${exe} install`)).toBeGreaterThan(i(`${exe} uninstall`));
    expect(i('sc.exe config KrakenOS obj= NT SERVICE\\KrakenOS')).toBeGreaterThan(
      i(`${exe} install`),
    );
    expect(i(`${exe} start`)).toBeGreaterThan(i('sc.exe sidtype KrakenOS unrestricted'));
  });

  it('si Windows tarda en dar de baja el servicio, espera antes de volver a instalarlo y no se queda esperando para siempre', async () => {
    const ev: Ev[] = [];
    let bajas = 0;
    const run = async (cmd: string, args: string[]) => {
      ev.push([cmd, ...args].join(' '));
      if (cmd === 'sc.exe' && args[0] === 'query')
        return ev.includes(`${exe} uninstall`) && bajas++ >= 2
          ? { code: 1060, stdout: '' }
          : { code: 0, stdout: 'ESTADO : 1  DETENIDO' };
      return { code: 0, stdout: '' };
    };
    await installService({ serviceExe: exe, run, sleep: async () => {} });
    expect(ev.indexOf(`${exe} install`)).toBeGreaterThan(-1);
    const eterno = async (cmd: string, args: string[]) =>
      cmd === 'sc.exe' && args[0] === 'query'
        ? { code: 0, stdout: 'ESTADO : 1  DETENIDO' }
        : { code: 0, stdout: '' };
    await expect(
      installService({ serviceExe: exe, run: eterno, sleep: async () => {} }),
    ).rejects.toThrow(/marcado para borrarse|sigue registrado/);
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

describe('waitHealthy con HTTPS', () => {
  it('con https consulta el mismo /health/ready por https en 127.0.0.1', async () => {
    const urls: string[] = [];
    await expect(
      waitHealthy(3002, 20, async (u: string) => (urls.push(u), 503), {
        intervalMs: 5,
        https: true,
      }),
    ).rejects.toThrow(/3002/);
    expect(urls[0]).toBe('https://127.0.0.1:3002/health/ready');
  });
});

describe('localHostname', () => {
  it('sanea como local_hostname de Linux: primer segmento, minúsculas, solo a-z0-9-, o krakenos', () => {
    expect(localHostname('MI-PC.lan')).toBe('mi-pc');
    expect(localHostname('Sala_de_Estar!')).toBe('saladeestar');
    expect(localHostname('___')).toBe('krakenos');
    expect(localHostname('')).toBe('krakenos');
  });
});

describe('TLS: setupTls, writeWindowJson, registerRenewalTask y renew', () => {
  const INST = join('C:', 'Program Files', 'KrakenOS');
  const CA = join(DATOS, 'ca');
  const TLS = join(DATOS, 'tls');
  const CA_PEM_TLS = join(TLS, 'krakenos-ca.pem');
  const CA_PEM_CA = join(CA, 'krakenos-ca.pem');
  const CA_KEY = join(CA, 'krakenos-ca-key.pem');
  let tmp: string;
  let pem: string;
  let clave: string;
  let claveAjena: string;
  beforeAll(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'kr-ca-'));
    await ensureLocalCa({
      certsDir: join(tmp, 'tls'),
      keysDir: join(tmp, 'ca'),
      hostname: 'prueba',
      lanIps: [],
    });
    pem = readFileSync(join(tmp, 'tls', 'krakenos-ca.pem'), 'utf8');
    clave = readFileSync(join(tmp, 'ca', 'krakenos-ca-key.pem'), 'utf8');
    await ensureLocalCa({
      certsDir: join(tmp, 'tls2'),
      keysDir: join(tmp, 'ca2'),
      hostname: 'otra',
      lanIps: [],
    });
    claveAjena = readFileSync(join(tmp, 'ca2', 'krakenos-ca-key.pem'), 'utf8');
  });
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  /** `run` que, al lanzar local-ca.js, deja la CA pública en tls\ como hace de verdad. */
  function montar(
    opts: {
      sinCa?: boolean;
      falla?: boolean;
      aclCa?: string;
      claveAjena?: boolean;
      hkml?: string;
    } = {},
  ) {
    ENVS.length = 0;
    const ev: Ev[] = [];
    const nodos: Record<string, Nodo> = { [join(DATOS, '.env')]: { kind: 'file', text: 'X=1\n' } };
    const fs = fakeFs(ev, nodos);
    const base = fakeRun(
      ev,
      opts.falla ? { 'local-ca.js': 1 } : {},
      {
        ...(opts.aclCa ? { [`GetAccessControl('${CA}')`]: opts.aclCa } : {}),
        ...(opts.hkml ? { 'reg.exe query': `    CaThumbprint    REG_SZ    ${opts.hkml}\r\n` } : {}),
      },
      { abierta: false },
    );
    const run = async (cmd: string, args: string[], o?: { env?: Record<string, string> }) => {
      const r = await base(cmd, args, o);
      if (args.some((a) => a.endsWith('local-ca.js')) && r.code === 0 && !opts.sinCa) {
        nodos[CA_PEM_TLS] = { kind: 'file', text: pem };
        nodos[CA_KEY] = { kind: 'file', text: opts.claveAjena ? claveAjena : clave };
      }
      return r;
    };
    const deps = {
      installDir: INST,
      dataDir: DATOS,
      hostname: 'prueba',
      port: 3002,
      run,
      fs,
      setKey,
    };
    return { ev, nodos, deps };
  }

  it('cierra y verifica ca\\ por SID ANTES de lanzar local-ca.js (que escribe la clave allí)', async () => {
    const { ev, deps } = montar();
    await setupTls(deps);
    const verif = ev.findIndex((l) => l.includes(`GetAccessControl('${CA}')`));
    const ca = ev.findIndex((l) => l.includes('local-ca.js'));
    expect(verif).toBeGreaterThan(-1);
    expect(verif).toBeLessThan(ca);
  });

  it('si ca\\ no está como debe (p. ej. el servicio la modifica) aborta SIN lanzar local-ca.js', async () => {
    const aclCa = [
      'OWNER:S-1-5-32-544',
      'S-1-5-18|FullControl|Allow|False',
      'S-1-5-32-544|FullControl|Allow|False',
      `${virtualAccountSid('KrakenOS')}|Modify|Allow|True`,
    ].join('\n');
    const { ev, deps } = montar({ aclCa });
    await expect(setupTls(deps)).rejects.toThrow(/ACL de .*ca/);
    expect(ev.some((l) => l.includes('local-ca.js'))).toBe(false);
  });

  it('local-ca.js corre con el Node empaquetado y las variables del paquete (certs en tls, claves en ca)', async () => {
    const { ev, deps } = montar();
    await setupTls(deps);
    const l = ev.find((x) => x.includes('local-ca.js')) as string;
    expect(l.startsWith(join(INST, 'node', 'node.exe'))).toBe(true);
    expect(l).toContain(join(INST, 'app', 'agent', 'dist', 'local-ca.js'));
    expect(ENVS[0]).toMatchObject({
      KRAKENOS_CERTS_DIR: TLS,
      KRAKENOS_KEYS_DIR: CA,
      KRAKENOS_HOSTNAME: 'prueba',
    });
  });

  it('importa la CA con certutil -addstore -f Root desde ca\\ (no desde tls\\) y guarda el thumbprint SHA-1 en HKLM', async () => {
    const { ev, deps } = montar();
    const r = await setupTls(deps);
    expect(ev).toContain(`certutil -addstore -f Root ${CA_PEM_CA}`);
    expect(ev.some((x) => x.startsWith('certutil') && x.includes(TLS))).toBe(false);
    const esperado = new X509Certificate(pem).fingerprint.replaceAll(':', '');
    expect(r.thumbprint).toBe(esperado);
    expect(esperado).toMatch(/^[0-9A-F]{40}$/);
    expect(ev).toContain(
      `reg.exe add HKLM\\SOFTWARE\\KrakenOS /v CaThumbprint /t REG_SZ /d ${esperado} /f`,
    );
    // El orden: se escribe la copia de ca\ antes de importarla y el thumbprint después.
    expect(ev.indexOf(`write ${CA_PEM_CA}`)).toBeLessThan(
      ev.findIndex((x) => x.startsWith('certutil')),
    );
  });

  it('fija en el .env HTTPS, rutas, WEB_ORIGIN y WebAuthn con https://<host>.local:<puerto>', async () => {
    const { nodos, deps } = montar();
    const r = await setupTls(deps);
    const env = nodos[join(DATOS, '.env')]?.text as string;
    expect(r.origin).toBe('https://prueba.local:3002');
    expect(env).toContain('X=1');
    expect(env).toMatch(/^HTTPS_ENABLED=true$/m);
    expect(env).toContain(`TLS_CERT_PATH=${join(TLS, 'agent-cert.pem')}`);
    expect(env).toContain(`TLS_KEY_PATH=${join(TLS, 'agent-key.pem')}`);
    expect(env).toContain(`TLS_CA_CERT_PATH=${CA_PEM_TLS}`);
    expect(env).toMatch(/^WEB_ORIGIN=https:\/\/prueba\.local:3002$/m);
    expect(env).toMatch(/^WEBAUTHN_RP_ID=prueba\.local$/m);
    expect(env).toMatch(/^WEBAUTHN_ORIGIN=https:\/\/prueba\.local:3002$/m);
  });

  it('el origen no lleva :443', async () => {
    const { deps } = montar();
    expect((await setupTls({ ...deps, port: 443 })).origin).toBe('https://prueba.local');
  });

  it('guarda la configuración de la renovación en ca\\tls.json (solo SYSTEM+Admins), sin token ni claves', async () => {
    const { nodos, deps } = montar();
    await setupTls(deps);
    const cfg = nodos[join(CA, 'tls.json')]?.text as string;
    expect(JSON.parse(cfg)).toEqual({ hostname: 'prueba', certsDir: TLS, keysDir: CA });
    expect(cfg).not.toMatch(/token|PRIVATE/i);
  });

  it('si local-ca.js falla, la instalación falla con mensaje y no importa nada ni toca el .env', async () => {
    const { ev, nodos, deps } = montar({ falla: true });
    await expect(setupTls(deps)).rejects.toThrow(/local-ca/);
    expect(ev.some((x) => x.startsWith('certutil') || x.startsWith('reg.exe add'))).toBe(false);
    expect(nodos[join(DATOS, '.env')]?.text).toBe('X=1\n');
  });

  it('si local-ca.js no dejó la CA, falla en vez de seguir en HTTP', async () => {
    const { deps } = montar({ sinCa: true });
    await expect(setupTls(deps)).rejects.toThrow(/krakenos-ca\.pem/);
  });

  it('el certificado importado tiene que ser el de la clave de ca\\: si no casan, falla cerrado sin importar', async () => {
    const { ev, deps } = montar({ claveAjena: true });
    await expect(setupTls(deps)).rejects.toThrow(/no corresponde a la clave/);
    expect(ev.some((x) => x.startsWith('certutil') || x.startsWith('reg.exe add'))).toBe(false);
  });

  it('con la CA expuesta (ACL abierta rehecha) NO la adopta: borra la vieja de Root por su thumbprint de HKLM, la regenera y reimporta', async () => {
    const viejo = 'A'.repeat(40);
    const { ev, deps } = montar({ hkml: viejo });
    const r = await setupTls({ ...deps, rotarCa: true });
    const i = (t: string) => ev.findIndex((x) => x.includes(t));
    expect(ev).toContain(`certutil -delstore Root ${viejo}`);
    expect(i(`certutil -delstore Root ${viejo}`)).toBeLessThan(i('local-ca.js'));
    for (const f of [CA_KEY, CA_PEM_TLS, join(TLS, 'agent-key.pem'), join(TLS, 'agent-cert.pem')])
      expect(ev.indexOf(`rm ${f}`)).toBeGreaterThan(-1);
    expect(ev.indexOf(`rm ${CA_KEY}`)).toBeLessThan(i('local-ca.js'));
    expect(ev).toContain(`certutil -addstore -f Root ${CA_PEM_CA}`);
    expect(r.rotada).toBe(true);
  });

  it('delstore: «no estaba» es ok, cualquier otro error falla', async () => {
    const viejo = 'C'.repeat(40);
    const a = montar({ hkml: viejo });
    const base = a.deps.run;
    const conCodigo =
      (code: number, stdout: string) => async (c: string, args: string[], o?: never) =>
        args.includes('-delstore') ? { code, stdout } : base(c, args, o);
    await expect(
      setupTls({
        ...a.deps,
        rotarCa: true,
        run: conCodigo(-2146885628, 'CertUtil: -delstore: no se encontró (0x80092004)'),
      }),
    ).resolves.toBeTruthy();
    const b = montar({ hkml: viejo });
    const base2 = b.deps.run;
    await expect(
      setupTls({
        ...b.deps,
        rotarCa: true,
        run: async (c: string, args: string[], o?: never) =>
          args.includes('-delstore') ? { code: 5, stdout: 'Acceso denegado' } : base2(c, args, o),
      }),
    ).rejects.toThrow(/delstore/);
    expect(b.ev.some((x) => x.includes('local-ca.js'))).toBe(false);
  });

  it('sin exposición y con el mismo thumbprint en HKLM no borra nada ni toca Root salvo importar (se conserva la misma CA)', async () => {
    const mismo = new X509Certificate(pem).fingerprint.replaceAll(':', '');
    const { ev, deps } = montar({ hkml: mismo });
    const r = await setupTls(deps);
    expect(ev.some((x) => x.includes('-delstore') || x.startsWith('rm '))).toBe(false);
    expect(r.rotada).toBe(false);
  });

  it('si HKLM anotaba otra CA (ca\\ llegó vacía, sin rotarCa) quita la vieja de Root tras importar la nueva y antes de anotarla', async () => {
    const viejo = 'D'.repeat(40);
    const { ev, deps } = montar({ hkml: viejo });
    const r = await setupTls(deps);
    const i = (t: string) => ev.findIndex((x) => x.includes(t));
    expect(i(`certutil -addstore -f Root ${CA_PEM_CA}`)).toBeGreaterThan(-1);
    expect(i(`certutil -delstore Root ${viejo}`)).toBeGreaterThan(i('-addstore'));
    expect(i(`certutil -delstore Root ${viejo}`)).toBeLessThan(i('reg.exe add'));
    expect(ev).toContain(
      `reg.exe add HKLM\\SOFTWARE\\KrakenOS /v CaThumbprint /t REG_SZ /d ${r.thumbprint} /f`,
    );
  });

  it('si quitar la vieja falla (error distinto de «no estaba») la instalación falla y HKLM conserva el thumbprint viejo', async () => {
    const { ev, deps } = montar({ hkml: 'E'.repeat(40) });
    const base = deps.run;
    await expect(
      setupTls({
        ...deps,
        run: async (c: string, args: string[], o?: never) =>
          args.includes('-delstore') ? { code: 5, stdout: 'Acceso denegado' } : base(c, args, o),
      }),
    ).rejects.toThrow(/delstore/);
    expect(ev.some((x) => x.startsWith('reg.exe add'))).toBe(false);
  });

  it('window.json se prepara en ca\\ (cerrada) con su ACL y se renombra a su sitio: nunca nace heredando del servicio', async () => {
    const ev: Ev[] = [];
    const nodos: Record<string, Nodo> = {};
    const f = join(DATOS, 'window.json');
    const t = join(CA, 'window.json.tmp');
    await writeWindowJson({
      dataDir: DATOS,
      origin: 'https://prueba.local:3002',
      run: fakeRun(ev),
      fs: fakeFs(ev, nodos),
    });
    expect(JSON.parse(nodos[f]?.text as string)).toEqual({ origin: 'https://prueba.local:3002' });
    expect(nodos[t]).toBeUndefined();
    const k = (x: string) => ev.findIndex((l) => l.includes(x));
    expect(ev).toContain(`rm ${t}`);
    expect(k(`write (wx) ${t}`)).toBeLessThan(k(`icacls ${t}`));
    expect(k(`icacls ${t}`)).toBeLessThan(k(`rename ${t} ${f}`));
    // icacls opera sobre el enlace (/L), y solo sobre el temporal: nunca sobre datos\window.json.
    expect(ev.filter((l) => l.startsWith('icacls'))).toEqual([
      `icacls ${t} /grant:r *S-1-5-18:(F) ${ADMINS}:(F) *S-1-5-32-545:(R) /inheritance:r /L`,
    ]);
  });

  it('window.json: si tras renombrar lo que hay no es un fichero normal (enlace o carpeta), aborta', async () => {
    const ev: Ev[] = [];
    const nodos: Record<string, Nodo> = {};
    const fs = fakeFs(ev, nodos);
    const rename = fs.rename;
    fs.rename = async (a: string, b: string) => {
      await rename(a, b);
      nodos[b] = { kind: 'link' };
    };
    await expect(
      writeWindowJson({ dataDir: DATOS, origin: 'https://x', run: fakeRun(ev), fs }),
    ).rejects.toThrow(/window\.json/);
  });

  it('la tarea de renovación corre como SYSTEM y ejecuta SOLO código de Program Files', async () => {
    const ev: Ev[] = [];
    await registerRenewalTask({ installDir: INST, dataDir: DATOS, run: fakeRun(ev) });
    const l = ev.find((x) => x.startsWith('schtasks')) as string;
    expect(l).toContain('/Create');
    expect(l).toContain('/TN \\KrakenOS\\RenovarTLS');
    expect(l).toContain('/SC WEEKLY');
    expect(l).toContain('/RU SYSTEM');
    expect(l).toContain('/F');
    const tr = /\/TR (.*?) \/F/.exec(l)?.[1] as string;
    const rutas = [...tr.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(rutas[0]).toBe(join(INST, 'node', 'node.exe'));
    expect(rutas[1]).toBe(join(INST, 'installer', 'renew-tls.mjs'));
    expect(rutas[1]?.endsWith('.mjs')).toBe(true);
    // Lo que se ejecuta nunca sale de la carpeta de datos (la datos solo viaja como argumento).
    expect(rutas.slice(0, 2).some((r) => r?.startsWith(DATOS))).toBe(false);
  });

  it('renew-tls lee su configuración de ca\\tls.json, nunca del .env, y lanza local-ca.js de Program Files', async () => {
    const leidos: string[] = [];
    const lanzados: { cmd: string; args: string[]; env: Record<string, string> }[] = [];
    await renew({
      dataDir: DATOS,
      localCa: join(INST, 'app', 'agent', 'dist', 'local-ca.js'),
      node: join(INST, 'node', 'node.exe'),
      readFile: (p: string) => {
        leidos.push(p);
        return JSON.stringify({ hostname: 'prueba', certsDir: TLS, keysDir: CA });
      },
      run: (cmd: string, args: string[], env: Record<string, string>) => {
        lanzados.push({ cmd, args, env });
        return 0;
      },
    });
    expect(leidos).toEqual([join(CA, 'tls.json')]);
    expect(lanzados).toHaveLength(1);
    expect(lanzados[0]?.args).toEqual([join(INST, 'app', 'agent', 'dist', 'local-ca.js')]);
    expect(lanzados[0]?.env).toMatchObject({
      KRAKENOS_CERTS_DIR: TLS,
      KRAKENOS_KEYS_DIR: CA,
      KRAKENOS_HOSTNAME: 'prueba',
    });
  });

  it('renew-tls falla si la configuración está incompleta o local-ca.js sale con error', async () => {
    const base = { dataDir: DATOS, localCa: 'l.js', node: 'n.exe', run: () => 0 };
    await expect(renew({ ...base, readFile: () => '{"hostname":"x"}' })).rejects.toThrow(
      /tls\.json/,
    );
    await expect(
      renew({
        ...base,
        readFile: () => JSON.stringify({ hostname: 'x', certsDir: 'a', keysDir: 'b' }),
        run: () => 1,
      }),
    ).rejects.toThrow(/local-ca/);
  });
});

let PEM_PRUEBA = '';
let KEY_PRUEBA = '';
beforeAll(async () => {
  const t = mkdtempSync(join(tmpdir(), 'kr-ca2-'));
  await ensureLocalCa({
    certsDir: join(t, 'tls'),
    keysDir: join(t, 'ca'),
    hostname: 'x',
    lanIps: [],
  });
  PEM_PRUEBA = readFileSync(join(t, 'tls', 'krakenos-ca.pem'), 'utf8');
  KEY_PRUEBA = readFileSync(join(t, 'ca', 'krakenos-ca-key.pem'), 'utf8');
  rmSync(t, { recursive: true, force: true });
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
    const codes: Record<string, number> = { 'sc.exe query': 1060 };
    const base = fakeRun(
      ev,
      codes,
      opts.envPrevio ? { 'reg.exe query': `DataDir REG_SZ ${DATOS}` } : {},
    );
    const run = async (cmd: string, args: string[], o?: { env?: Record<string, string> }) => {
      if (args.some((a) => a.endsWith('local-ca.js'))) {
        nodos[join(DATOS, 'tls', 'krakenos-ca.pem')] = { kind: 'file', text: PEM_PRUEBA };
        nodos[join(DATOS, 'ca', 'krakenos-ca-key.pem')] = { kind: 'file', text: KEY_PRUEBA };
      }
      return base(cmd, args, o);
    };
    const deps = {
      installDir: INST,
      dataDir: DATOS,
      hostname: 'MI-PC.lan',
      run,
      fs,
      isFree: async (p: number) => !(opts.ocupados ?? []).includes(p),
      get: async () => 200,
      setKey,
      ensureEnv: (d: string) => {
        ev.push(`ensureEnv ${d}`);
        if (opts.falla === 'env') throw new Error('boom');
        if (nodos[join(d, '.env')]) return false;
        nodos[join(d, '.env')] = { kind: 'file', text: 'DRIVER_KIND=none\n' };
        return true;
      },
      ensureKeys: () => ev.push('ensureKeys'),
      log: () => {},
      sleep: async () => {},
    };
    return { ev, nodos, deps, codes };
  }

  it('hace los pasos en orden: datos, .env, claves, servicio, salud', async () => {
    const { ev, deps } = montar();
    const r = await runInstall(deps);
    const i = (s: string) => ev.findIndex((l) => l.includes(s));
    expect(i('SetAccessControl')).toBeLessThan(i('ensureEnv'));
    expect(i('ensureEnv')).toBeLessThan(i('ensureKeys'));
    expect(i('ensureKeys')).toBeLessThan(i(' install'));
    expect(i(' install')).toBeLessThan(i('/grant:r *S-1-5-80'));
    expect(i('/grant:r *S-1-5-80')).toBeLessThan(i(' start'));
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

  it('al actualizar con HOST=127.0.0.1 y su puerto libre, lo que ya había en el .env queda byte a byte igual (solo se añade el HTTPS)', async () => {
    const previo = '# mío\nDRIVER_KIND=none\nHOST=127.0.0.1\nPORT=3005\n';
    const { ev, deps, nodos } = montar({ envPrevio: previo });
    await runInstall(deps);
    expect(nodos[join(DATOS, '.env')]?.text?.startsWith(previo)).toBe(true);
    expect(ev.filter((l) => l === `write ${join(DATOS, '.env')}`)).toHaveLength(1); // solo el de TLS
  });

  it('al actualizar con su puerto ocupado pasa al siguiente libre, lo dice y respeta HOST', async () => {
    const lineas: string[] = [];
    const { deps, nodos } = montar({
      envPrevio: 'HOST=127.0.0.1\nPORT=3005\n',
      ocupados: [3005],
    });
    const r = await runInstall({ ...deps, log: (l: string) => lineas.push(l) });
    expect(r.port).toBe(3006);
    expect(nodos[join(DATOS, '.env')]?.text).toMatch(
      /^HOST=127\.0\.0\.1\nPORT=3006\nHTTPS_ENABLED=true\n/,
    );
    expect(lineas.join('\n')).toContain('3006');
  });

  it('al actualizar parte del PORT que ya tenía el .env, no de 3001', async () => {
    const { deps, nodos } = montar({ envPrevio: 'PORT=3005\n' });
    const r = await runInstall(deps);
    expect(r.port).toBe(3005);
    expect(nodos[join(DATOS, '.env')]?.text).toMatch(/^PORT=3005$/m);
  });

  it('el HTTPS queda listo ANTES de arrancar el servicio y la salud se pide por https en el puerto elegido', async () => {
    const urls: string[] = [];
    const { ev, nodos, deps } = montar({ ocupados: [3001] });
    await runInstall({ ...deps, get: async (u: string) => (urls.push(u), 200) });
    const i = (s: string) => ev.findIndex((l) => l.includes(s));
    expect(i('local-ca.js')).toBeGreaterThan(i('ensureKeys'));
    expect(i('certutil')).toBeLessThan(i(' start'));
    expect(i('schtasks')).toBeLessThan(i(' start'));
    expect(urls[0]).toBe('https://127.0.0.1:3002/health/ready');
    // El puerto sale del .env elegido (3002), nunca un 3001 fijo; el nombre, saneado.
    expect(nodos[join(DATOS, '.env')]?.text).toMatch(/^WEB_ORIGIN=https:\/\/mi-pc\.local:3002$/m);
    expect(JSON.parse(nodos[join(DATOS, 'window.json')]?.text as string)).toEqual({
      origin: 'https://mi-pc.local:3002',
    });
  });

  it('una instalación sobre una ca\\ que estaba abierta rota la CA y lo dice', async () => {
    const lineas: string[] = [];
    const { ev, deps, nodos } = montar({ envPrevio: 'PORT=3005\n' });
    const ca = join(DATOS, 'ca');
    nodos[DATOS] = { kind: 'dir', entries: ['.env', 'ca'] };
    nodos[ca] = { kind: 'dir', entries: ['krakenos-ca-key.pem'] };
    nodos[join(ca, 'krakenos-ca-key.pem')] = { kind: 'file', text: 'vieja' };
    await runInstall({ ...deps, log: (l: string) => lineas.push(l) });
    expect(ev.indexOf(`rm ${join(ca, 'krakenos-ca-key.pem')}`)).toBeGreaterThan(-1);
    expect(lineas.join('\n')).toMatch(/CA nueva/);
  });

  it('si la instalación falla tras cerrar la ACL de ca\\, el reintento rota la CA igual (la marca vive en HKLM): no la adopta', async () => {
    const { ev, deps, nodos, codes } = montar({ envPrevio: 'PORT=3005\n' });
    const ca = join(DATOS, 'ca');
    nodos[DATOS] = { kind: 'dir', entries: ['.env', 'ca'] };
    nodos[ca] = { kind: 'dir', entries: ['krakenos-ca-key.pem'] };
    nodos[join(ca, 'krakenos-ca-key.pem')] = { kind: 'file', text: 'vieja' };
    const marca = (l: string) => l.includes('CaPendienteRotar');
    codes['local-ca.js'] = 1; // falla justo después de cerrar la ACL y de borrar lo viejo
    await expect(runInstall(deps)).rejects.toThrow(/local-ca/);
    expect(ev.findIndex(marca)).toBeLessThan(
      ev.findIndex((l) => l.includes("SetAccessControl('" + ca)),
    );
    expect(ev.some((l) => l.startsWith('reg.exe delete') && marca(l))).toBe(false);
    delete codes['local-ca.js'];
    const n = ev.length;
    await runInstall(deps);
    const segundo = ev.slice(n);
    // La ACL ya estaba bien (no hay SetAccessControl sobre ca\), y aun así se rota.
    expect(segundo.some((l) => l.includes("SetAccessControl('" + ca))).toBe(false);
    expect(segundo.some((l) => l.startsWith(`rm ${join(ca, 'krakenos-ca-key.pem')}`))).toBe(true);
    expect(segundo.some((l) => l.startsWith('reg.exe delete') && marca(l))).toBe(true);
    // Terminada la rotación, un tercer intento ya no rota.
    const m = ev.length;
    await runInstall(deps);
    expect(ev.slice(m).some((l) => l.startsWith(`rm ${join(ca, 'krakenos-ca-key.pem')}`))).toBe(
      false,
    );
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

describe('cortafuegos y perfil de red', () => {
  const NODE = join('C:', 'Program Files', 'KrakenOS', 'node', 'node.exe');
  const nuevas = (ev: string[]) => ev.filter((l) => l.includes('New-NetFirewallRule'));

  it('toda regla es de entrada, Allow, solo perfil Private y atada al node.exe', async () => {
    for (const mdns of [false, true]) {
      const ev: string[] = [];
      await openFirewall({ nodeExe: NODE, port: 3002, mdns, run: fakeRun(ev) });
      const reglas = nuevas(ev);
      expect(reglas).toHaveLength(mdns ? 2 : 1);
      for (const l of reglas) {
        expect(l).toMatch(/-Profile Private(?![\w,])/);
        expect(l).not.toMatch(/Public|Domain|-Profile Any/);
        expect(l).toContain('-Direction Inbound -Action Allow');
        expect(l).toContain('-Group KrakenOS');
        expect(l).toContain(`-Program '${NODE}'`);
      }
      expect(reglas[0]).toContain('-Protocol TCP -LocalPort 3002');
      if (mdns) expect(reglas[1]).toContain('-Protocol UDP -LocalPort 5353');
    }
  });

  it('borra antes las reglas del grupo (reinstalar no las duplica) y falla si el cortafuegos falla', async () => {
    const ev: string[] = [];
    await openFirewall({ nodeExe: NODE, port: 3001, mdns: false, run: fakeRun(ev) });
    expect(ev[0]).toContain('Get-NetFirewallRule -Group KrakenOS');
    expect(ev[0]).toContain('Remove-NetFirewallRule');
    await expect(
      openFirewall({
        nodeExe: NODE,
        port: 3001,
        mdns: false,
        run: fakeRun([], { 'New-NetFirewallRule': 1 }),
      }),
    ).rejects.toThrow(/salió con 1/);
  });

  it('activeNetwork lee la red de la ruta por defecto y devuelve null si no hay ruta o no se entiende', async () => {
    const json = '{"name":"CASA-5G","interfaceIndex":12,"category":"Public"}\r\n';
    expect(await activeNetwork(fakeRun([], {}, { 'Get-NetRoute': json }))).toEqual({
      name: 'CASA-5G',
      interfaceIndex: 12,
      category: 'Public',
    });
    expect(await activeNetwork(fakeRun([], {}, { 'Get-NetRoute': '' }))).toBeNull();
    expect(
      await activeNetwork(fakeRun([], {}, { 'Get-NetRoute': '{"category":"Otra"}' })),
    ).toBeNull();
    expect(await activeNetwork(fakeRun([], { 'Get-NetRoute': 1 }))).toBeNull();
  });

  describe('offerPrivateNetwork', () => {
    const publica = { name: 'CASA', interfaceIndex: 7, category: 'Public' };
    const montar = (respuesta: boolean) => {
      const ev: string[] = [];
      const preguntas: string[] = [];
      const ask = async (n: { name: string }) => (preguntas.push(n.name), respuesta);
      return { ev, preguntas, ask, run: fakeRun(ev) };
    };

    it('Pública y se acepta: la pasa a Privada solo en esa interfaz', async () => {
      const { ev, ask, run, preguntas } = montar(true);
      expect(await offerPrivateNetwork({ net: publica, silent: false, ask, run })).toBe('cambiada');
      expect(preguntas).toEqual(['CASA']);
      expect(ev).toHaveLength(1);
      expect(ev[0]).toContain(
        'Set-NetConnectionProfile -InterfaceIndex 7 -NetworkCategory Private',
      );
    });

    it('Pública y se rechaza: no toca nada', async () => {
      const { ev, ask, run } = montar(false);
      expect(await offerPrivateNetwork({ net: publica, silent: false, ask, run })).toBe(
        'rechazada',
      );
      expect(ev).toEqual([]);
    });

    it('en silencio nunca pregunta ni cambia nada, aunque sea Pública', async () => {
      const { ev, ask, run, preguntas } = montar(true);
      expect(await offerPrivateNetwork({ net: publica, silent: true, ask, run })).toBe('rechazada');
      expect(preguntas).toEqual([]);
      expect(ev).toEqual([]);
    });

    it.each([
      ['dominio', { name: 'CORP', interfaceIndex: 3, category: 'DomainAuthenticated' }],
      ['privada', { name: 'CASA', interfaceIndex: 3, category: 'Private' }],
      ['sin red', null],
    ])('%s: no aplica y no pregunta', async (_n, net) => {
      const { ev, ask, run, preguntas } = montar(true);
      expect(await offerPrivateNetwork({ net, silent: false, ask, run })).toBe('no-aplica');
      expect(preguntas).toEqual([]);
      expect(ev).toEqual([]);
    });
  });

  it('showDialog manda el texto por el entorno, no por la línea de comandos, y lee el botón del código', async () => {
    ENVS.length = 0;
    const ev: string[] = [];
    expect(await showDialog({ run: fakeRun(ev), title: 'T', text: "¿'x'?", yesNo: true })).toBe(
      true,
    );
    expect(ev[0]).toContain("'YesNo'");
    expect(ev[0]).not.toContain('¿');
    expect(ENVS.at(-1)).toEqual({ KR_TEXTO: "¿'x'?", KR_TITULO: 'T' });
    expect(
      await showDialog({ run: fakeRun([], { Forms: 3 }), title: 'T', text: 'x', yesNo: true }),
    ).toBe(false);
  });
});

describe('runInstall: cortafuegos, red y energía', () => {
  const INST = join('C:', 'Program Files', 'KrakenOS');
  const RED_PUBLICA = '{"name":"CASA","interfaceIndex":7,"category":"Public"}';

  async function instalar(
    extra: Record<string, unknown> = {},
    stdouts: Record<string, string> = {},
    envPrevio = '',
  ) {
    const ev: Ev[] = [];
    const lineas: string[] = [];
    const nodos: Record<string, Nodo> = {
      [join(INST, 'service', 'KrakenOS-service.xml')]: {
        kind: 'file',
        text: '<env name="PORT" value="3001"/>',
      },
      [join(DATOS, '.env')]: { kind: 'file', text: envPrevio },
    };
    const base = fakeRun(
      ev,
      { 'sc.exe query': 1060 },
      { 'reg.exe query': `DataDir REG_SZ ${DATOS}`, ...stdouts },
    );
    const run = async (cmd: string, args: string[], o?: { env?: Record<string, string> }) => {
      if (args.some((a) => a.endsWith('local-ca.js'))) {
        nodos[join(DATOS, 'tls', 'krakenos-ca.pem')] = { kind: 'file', text: PEM_PRUEBA };
        nodos[join(DATOS, 'ca', 'krakenos-ca-key.pem')] = { kind: 'file', text: KEY_PRUEBA };
      }
      return base(cmd, args, o);
    };
    nodos[DATOS] = { kind: 'dir', entries: ['.env'] };
    const preguntas: string[] = [];
    const avisos: string[] = [];
    const r = await runInstall({
      installDir: INST,
      dataDir: DATOS,
      hostname: 'MI-PC',
      run,
      fs: fakeFs(ev, nodos),
      isFree: async () => true,
      get: async () => 200,
      setKey,
      ensureEnv: () => false,
      ensureKeys: () => {},
      log: (l: string) => lineas.push(l),
      lang: 'es',
      ask: async (t: string) => (preguntas.push(t), true),
      notify: async (t: string) => void avisos.push(t),
      ...extra,
    });
    return { r, ev, lineas, preguntas, avisos };
  }

  it('abre el puerto elegido (no un 3001 fijo) y el UDP 5353 con mDNS por defecto', async () => {
    const { ev } = await instalar({ isFree: async (p: number) => p !== 3001 });
    const reglas = ev.filter((l) => l.includes('New-NetFirewallRule'));
    expect(reglas).toHaveLength(2);
    expect(reglas[0]).toContain('-Protocol TCP -LocalPort 3002');
    expect(reglas[1]).toContain('-Protocol UDP -LocalPort 5353');
  });

  it('con MDNS_RESPONDER=off no abre el UDP 5353', async () => {
    const { ev } = await instalar({}, {}, 'MDNS_RESPONDER=off\n');
    expect(ev.filter((l) => l.includes('New-NetFirewallRule'))).toHaveLength(1);
  });

  it('en silencio y con red Pública: ni pregunta, ni cambia el perfil, ni diálogo; el resumen lo dice', async () => {
    const { ev, lineas, preguntas, avisos } = await instalar({}, { 'Get-NetRoute': RED_PUBLICA });
    expect(preguntas).toEqual([]);
    expect(avisos).toEqual([]);
    expect(ev.some((l) => l.includes('Set-NetConnectionProfile'))).toBe(false);
    const todo = lineas.join('\n');
    expect(todo).toContain('no cambia el perfil de red');
    expect(todo).toContain('Si este equipo se suspende');
  });

  it('interactivo con red Pública: pregunta con el nombre de la red y, si se acepta, la pasa a Privada', async () => {
    const { ev, lineas, preguntas, avisos } = await instalar(
      { interactive: true },
      { 'Get-NetRoute': RED_PUBLICA },
    );
    expect(preguntas).toHaveLength(1);
    expect(preguntas[0]).toContain('«CASA»');
    expect(
      ev.some((l) =>
        l.includes('Set-NetConnectionProfile -InterfaceIndex 7 -NetworkCategory Private'),
      ),
    ).toBe(true);
    expect(lineas.join('\n')).toContain('ahora es privada');
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toContain('KrakenOS deja de vigilar');
  });

  it('interactivo y rechazado: no cambia nada y el resumen dice que el móvil no llegará', async () => {
    const { ev, lineas } = await instalar(
      { interactive: true, ask: async () => false },
      { 'Get-NetRoute': RED_PUBLICA },
    );
    expect(ev.some((l) => l.includes('Set-NetConnectionProfile'))).toBe(false);
    expect(lineas.join('\n')).toContain('el móvil no llegará');
  });

  it('nunca toca el plan de energía', async () => {
    const { ev } = await instalar({ interactive: true });
    expect(ev.join('\n')).not.toMatch(/powercfg|PowerPlan|Set-PowerPlan/i);
  });
});

describe('mensajes', () => {
  it('hay las mismas claves en es y en en', () => {
    expect(msg('es', 'puertoOcupado', 3001, 3002)).toContain('3002');
    expect(msg('en', 'puertoOcupado', 3001, 3002)).toContain('3002');
    expect(msg('es', 'puertoOcupado', 3001, 3002)).not.toBe(msg('en', 'puertoOcupado', 3001, 3002));
  });

  it('los mensajes del cortafuegos, la red y la energía existen en es y en en, distintos y con sus datos', () => {
    for (const [clave, args] of [
      ['cortafuegosListo', [3002]],
      ['tituloDialogo', []],
      ['preguntaRedPrivada', ['CASA']],
      ['redCambiada', ['CASA']],
      ['redRechazada', ['CASA']],
      ['redPublicaSilencio', ['CASA']],
      ['redNoPrivada', []],
      ['energia', []],
      ['datosConservados', ['C:\\ProgramData\\KrakenOS']],
      ['datosAjenos', ['C:\\ProgramData\\KrakenOS']],
      ['programaAjeno', ['C:\\Program Files\\Common Files']],
      ['falloDesinstalar', ['boom']],
    ] as const) {
      const es = msg('es', clave, ...args);
      const en = msg('en', clave, ...args);
      if (clave !== 'tituloDialogo') expect(es).not.toBe(en);
      if (args[0] !== undefined) expect(`${es}${en}`).toContain(String(args[0]));
    }
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

  it('POSTINSTALL solo pasa --interactive si el instalador no es silencioso', () => {
    const m = macro('NSIS_HOOK_POSTINSTALL');
    expect(m).toMatch(
      /\$\{If\} \$\{Silent\}\s+StrCpy \$R7 ""\s+\$\{Else\}\s+StrCpy \$R7 " --interactive"/,
    );
    expect(m).toMatch(/install --lang \$R8\$R7'/);
  });

  it('PREINSTALL para el servicio previo y aborta si no puede', () => {
    const m = macro('NSIS_HOOK_PREINSTALL');
    expect(m).toMatch(/post-install\.mjs" stop --lang \$R8'/);
    expect(m).not.toMatch(/--lang es/);
    expect(m.slice(m.indexOf('post-install.mjs'))).toMatch(/\$\{If\} \$0 != 0[\s\S]*Abort/);
  });

  it('ningún hook escribe el token de setup en el log', () => {
    expect(nsh).not.toMatch(/DetailPrint[^\n]*(token|TOKEN)/);
  });
});

describe('readSetupToken', () => {
  const FILE = join(DATOS, 'setup-token');
  const TOKEN = 'AbC123._~-tokenDePrueba';
  /** `fs` falso: registra qué se abre; `lst` lo que ve lstat, `contenido` lo que lee el descriptor. */
  function tokenFs(
    lst: null | { link?: boolean; file?: boolean; size?: number },
    contenido = TOKEN,
    nlink = 1,
  ) {
    const llamadas: string[] = [];
    return {
      llamadas,
      lstat: async (p: string) => {
        llamadas.push(`lstat ${p}`);
        if (!lst) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        return {
          isSymbolicLink: () => !!lst.link,
          isFile: () => lst.file ?? !lst.link,
          size: lst.size ?? Buffer.byteLength(contenido),
        };
      },
      open: async (p: string) => {
        llamadas.push(`open ${p}`);
        return {
          stat: async () => ({ isFile: () => true, size: Buffer.byteLength(contenido), nlink }),
          read: async (b: Buffer, o: number, n: number) => {
            const w = Buffer.from(contenido).subarray(0, n);
            w.copy(b, o);
            return { bytesRead: w.length };
          },
          close: async () => {
            llamadas.push('close');
          },
        };
      },
    };
  }
  const leer = (fs: ReturnType<typeof tokenFs>, warn: (m: string) => void = () => {}) =>
    readSetupToken({ file: FILE, waitMs: 0, fs, warn, sleep: async () => {} });

  it('devuelve el token de un fichero normal (sin espacios finales)', async () => {
    expect(await leer(tokenFs({}, `${TOKEN}\r\n`))).toBe(TOKEN);
  });

  it('ausente tras waitMs (actualización: ya hay admin) devuelve null, tras reintentar', async () => {
    const fs = tokenFs(null);
    const r = await readSetupToken({
      file: FILE,
      waitMs: 1000,
      fs,
      sleep: async () => {},
      intervalMs: 250,
    });
    expect(r).toBeNull();
    expect(fs.llamadas.filter((l) => l.startsWith('lstat')).length).toBeGreaterThan(2);
  });

  it('si aparece mientras espera, lo lee', async () => {
    const fs = tokenFs({});
    let n = 0;
    const lstat = fs.lstat;
    fs.lstat = async (p: string) => (n++ < 2 ? Promise.reject(new Error('ENOENT')) : lstat(p));
    const r = await readSetupToken({ file: FILE, waitMs: 5000, fs, sleep: async () => {} });
    expect(r).toBe(TOKEN);
  });

  it('un enlace simbólico (o junction) da null y NO se abre el destino', async () => {
    const fs = tokenFs({ link: true });
    expect(await leer(fs)).toBeNull();
    expect(fs.llamadas.some((l) => l.startsWith('open'))).toBe(false);
  });

  it('un directorio da null sin abrirlo', async () => {
    const fs = tokenFs({ file: false });
    expect(await leer(fs)).toBeNull();
    expect(fs.llamadas.some((l) => l.startsWith('open'))).toBe(false);
  });

  it('1 MB de basura da null sin abrirlo', async () => {
    const fs = tokenFs({ size: 1024 * 1024 }, 'x'.repeat(1024 * 1024));
    expect(await leer(fs)).toBeNull();
    expect(fs.llamadas.some((l) => l.startsWith('open'))).toBe(false);
  });

  it('si crece entre lstat y la lectura (>256 bytes leídos) da null y cierra el descriptor', async () => {
    const fs = tokenFs({ size: 10 }, 'a'.repeat(300));
    expect(await leer(fs)).toBeNull();
    expect(fs.llamadas).toContain('close');
  });

  it('un fichero con más de un enlace duro da null', async () => {
    expect(await leer(tokenFs({}, TOKEN, 2))).toBeNull();
  });

  it.each(['tok en con espacios', 'tok/../x', 'tok;calc', '', 'ñandú'])(
    'caracteres fuera del alfabeto (%j) dan null',
    async (c) => {
      expect(await leer(tokenFs({}, c))).toBeNull();
    },
  );

  it('nunca lanza por contenido raro y el warn recibe solo la ruta, no el contenido', async () => {
    const avisos: string[] = [];
    const secreto = 'sec ret;&';
    expect(await leer(tokenFs({}, secreto), (m) => avisos.push(m))).toBeNull();
    expect(avisos.length).toBeGreaterThan(0);
    for (const a of avisos) {
      expect(a).toContain(FILE);
      expect(a).not.toContain(secreto);
    }
    const buenos: string[] = [];
    await leer(tokenFs({}), (m) => buenos.push(m));
    expect(buenos.join('')).not.toContain(TOKEN);
  });

  it('un error al abrir da null', async () => {
    const fs = tokenFs({});
    fs.open = async () => {
      throw new Error('EPERM');
    };
    expect(await leer(fs)).toBeNull();
  });
});

describe('entrega del token a la ventana (hook y subcomando)', () => {
  const nsh = readFileSync(
    resolve(__dirname, '../../../../packaging/windows/installer-hooks.nsh'),
    'utf8',
  );
  const post = nsh.split('!macro NSIS_HOOK_POSTINSTALL')[1]?.split('!macroend')[0] ?? '';
  const subcmd = readFileSync(
    resolve(__dirname, '../../../../packaging/windows/installer/post-install.mjs'),
    'utf8',
  );

  it('solo si el instalador no es silencioso captura el token y lanza la ventana sin elevar', () => {
    expect(post).toMatch(/\$\{IfNot\} \$\{Silent\}[\s\S]*post-install\.mjs" setup-token/);
    expect(post).toMatch(/nsExec::ExecToStack/);
    expect(post).toMatch(
      /nsis_tauri_utils::RunAsUser "\$INSTDIR\\krakenos-window\.exe" "--setup-token \$1"/,
    );
    // Sin token (o fallo del subcomando): la ventana se abre sin argumentos.
    expect(post).toMatch(/RunAsUser "\$INSTDIR\\krakenos-window\.exe" ""/);
  });

  it('el token solo viaja a RunAsUser: ni DetailPrint, ni MessageBox, ni log; y se borra de la pila', () => {
    expect(nsh).not.toMatch(/(DetailPrint|MessageBox|FileWrite)[^\n]*\$1/);
    expect(post).toMatch(/StrCpy \$1 ""/);
  });

  it('el subcomando setup-token imprime solo el token por stdout y no falla la instalación', () => {
    expect(subcmd).toMatch(/orden === 'setup-token'/);
    expect(subcmd).toMatch(/process\.stdout\.write\(token\)/);
    // Sus avisos no pueden ir a stdout ni stderr (ExecToStack mezcla ambos): van al log junto al instalador.
    const rama = subcmd.split("orden === 'setup-token'")[1]?.split('else if')[0] ?? '';
    expect(rama).not.toMatch(/console\./);
  });
});

describe('uninstallAll', () => {
  const EXE = join('C:', 'Program Files', 'KrakenOS', 'service', 'KrakenOS-service.exe');
  const THUMB = 'A1B2C3D4E5F60718293A4B5C6D7E8F9012345678';
  const INST = join('C:', 'Program Files', 'KrakenOS');
  const RAIZ_INST: Record<string, Nodo['kind']> = {
    app: 'dir',
    service: 'dir',
    node: 'dir',
    installer: 'dir',
    'junction-plantada': 'link',
    'krakenos-window.exe': 'file',
    'uninstall.exe': 'file',
    'install-error.log': 'file',
  };
  const regla = { code: 0, stdout: '' };

  /** Máquina con todo instalado: lo que se borra deja de existir (así se prueba también la segunda vez). */
  function maquina(opt: { thumb?: string | null; servicio?: boolean; datos?: boolean } = {}) {
    const ev: Ev[] = [];
    const st = {
      servicio: opt.servicio ?? true,
      thumb: opt.thumb === undefined ? THUMB : opt.thumb,
      enRoot: opt.thumb !== null,
    };
    const nodos: Record<string, Nodo> = {
      ...(opt.datos === false ? {} : { [DATOS]: { kind: 'dir', entries: ['.env'] } }),
      [INST]: {
        kind: 'dir',
        entries: [...Object.keys(RAIZ_INST)],
      },
      ...Object.fromEntries(
        Object.entries(RAIZ_INST).map(([n, k]) => [
          join(INST, n),
          { kind: k, entries: [] } as Nodo,
        ]),
      ),
    };
    const run = async (cmd: string, args: string[]) => {
      const l = [cmd, ...args].join(' ');
      ev.push(l);
      if (cmd === EXE && args[0] === 'uninstall') st.servicio = false;
      if (cmd === 'sc.exe' && args[0] === 'query')
        return st.servicio
          ? { code: 0, stdout: 'ESTADO : 1  DETENIDO' }
          : { code: 1060, stdout: '' };
      if (cmd === 'reg.exe' && args[0] === 'query' && l.includes('CaThumbprint'))
        return st.thumb
          ? { code: 0, stdout: `    CaThumbprint    REG_SZ    ${st.thumb}\r\n` }
          : { code: 1, stdout: '' };
      if (cmd === 'reg.exe' && args[0] === 'delete' && l.includes('/v CaThumbprint'))
        st.thumb = null;
      if (cmd === 'reg.exe' && args[0] === 'query' && l.includes('/v DataDir'))
        return { code: 0, stdout: `    DataDir    REG_SZ    ${DATOS}\r\n` };
      if (cmd === 'certutil') {
        const hay = st.enRoot;
        st.enRoot = false;
        return hay
          ? regla
          : { code: 1, stdout: 'CertUtil: -delstore: no se encuentra el certificado 0x80092004' };
      }
      return regla;
    };
    return { ev, run, fs: fakeFs(ev, nodos), nodos };
  }
  const base = (
    m: ReturnType<typeof maquina>,
    extra: Partial<Parameters<typeof uninstallAll>[0]> = {},
  ) => ({
    run: m.run,
    fs: m.fs,
    dataDir: DATOS,
    serviceExe: EXE,
    installDir: INST,
    programFiles: join('C:', 'Program Files'),
    purgeData: false,
    update: false,
    removeLinks: async () => void m.ev.push('quitar-enlaces'),
    log: () => {},
    sleep: async () => {},
    ...extra,
  });

  /** Órdenes de borrado del fs falso. */
  const borrados = (ev: string[]) => ev.filter((l) => /^(rm|rmdir|unlink) /.test(l));
  /** Borrados que no caen ni bajo la carpeta de instalación ni bajo los datos. */
  const sueltos = (ev: string[]) =>
    borrados(ev).filter((l) => !l.includes(INST) && !l.includes(DATOS));

  it('quita servicio, regla, CA (por el thumbprint de HKLM), tarea, enlaces y la marca de la CA, y conserva los datos', async () => {
    const m = maquina();
    await uninstallAll(base(m));
    const lineas = m.ev;
    expect(lineas).toContain(`${EXE} uninstall`);
    expect(lineas.some((l) => l.includes('Remove-NetFirewallRule') && l.includes('KrakenOS'))).toBe(
      true,
    );
    expect(lineas).toContain(`certutil -delstore Root ${THUMB}`);
    expect(lineas.some((l) => l.includes('KrakenOS') && l.includes('DeleteTask'))).toBe(true);
    expect(lineas).toContain('quitar-enlaces');
    expect(lineas).toContain('reg.exe delete HKLM\\SOFTWARE\\KrakenOS /v CaThumbprint /f');
    // Con datos conservados, lo que identifica la carpeta como de KrakenOS se queda con ella.
    expect(lineas.some((l) => l.startsWith('reg.exe delete HKLM\\SOFTWARE\\KrakenOS /f'))).toBe(
      false,
    );
    expect(borrados(lineas).filter((l) => l.includes(DATOS))).toEqual([]);
    expect(sueltos(lineas)).toEqual([]);
  });

  it('el thumbprint sale de HKLM: no se lee nada de la carpeta de datos', async () => {
    const m = maquina();
    await uninstallAll(base(m));
    expect(m.ev.some((l) => l.includes('krakenos-ca'))).toBe(false);
    expect(m.ev.some((l) => l.startsWith('write'))).toBe(false);
    expect(m.ev.indexOf('reg.exe query HKLM\\SOFTWARE\\KrakenOS /v CaThumbprint')).toBeGreaterThan(
      -1,
    );
  });

  it('desinstalar dos veces seguidas termina bien y la segunda no falla por lo que ya no está', async () => {
    const m = maquina();
    await uninstallAll(base(m));
    await expect(uninstallAll(base(m))).resolves.toBeUndefined();
  });

  it('tolera que el servicio, la CA, las reglas y la tarea ya no existan', async () => {
    const m = maquina({ servicio: false, thumb: null });
    await expect(uninstallAll(base(m))).resolves.toBeUndefined();
    expect(m.ev.some((l) => l.startsWith('certutil'))).toBe(false);
    expect(m.ev.some((l) => l.endsWith(' uninstall'))).toBe(false);
  });

  it('si la CA no se puede quitar, lo dice, no borra la marca que permite reintentarlo y sigue con lo demás', async () => {
    const m = maquina();
    const run = async (cmd: string, args: string[]) =>
      cmd === 'certutil' ? { code: 5, stdout: 'Acceso denegado' } : m.run(cmd, args);
    await expect(uninstallAll(base(m, { run }))).rejects.toThrow(/CA/);
    expect(m.ev).toContain('quitar-enlaces');
    expect(m.ev.some((l) => l.includes('DeleteTask'))).toBe(true);
    expect(m.ev.some((l) => l.includes('/v CaThumbprint /f'))).toBe(false);
  });

  it('un fallo en un paso no impide los demás y se reporta al final con todos los nombres', async () => {
    const m = maquina();
    const run = async (cmd: string, args: string[]) =>
      cmd === 'powershell.exe' ? { code: 1, stdout: 'boom' } : m.run(cmd, args);
    await expect(uninstallAll(base(m, { run }))).rejects.toThrow(/cortafuegos[\s\S]*tarea/);
    expect(m.ev).toContain(`certutil -delstore Root ${THUMB}`);
  });

  it('con update no emite ninguna orden de borrado: solo para el servicio', async () => {
    const m = maquina();
    await uninstallAll(base(m, { update: true, purgeData: true }));
    const orden = m.ev.filter((l) => !l.startsWith('sc.exe query'));
    expect(orden.every((l) => l === `${EXE} stop` || l.startsWith('sc.exe query'))).toBe(true);
    expect(m.ev.some((l) => /uninstall|delete|Remove|certutil|schtasks|rm /i.test(l))).toBe(false);
  });

  it('sin purgeData nunca se borra la carpeta de datos', async () => {
    const m = maquina();
    await uninstallAll(base(m));
    expect(borrados(m.ev).filter((l) => l.includes(DATOS))).toEqual([]);
    expect(sueltos(m.ev)).toEqual([]);
    expect(m.nodos[DATOS]).toBeDefined();
  });

  it('con purgeData borra los datos y toda la clave de HKLM', async () => {
    const m = maquina();
    await uninstallAll(base(m, { purgeData: true }));
    expect(m.ev).toContain(`rmdir ${DATOS}`);
    expect(m.ev).toContain('reg.exe delete HKLM\\SOFTWARE\\KrakenOS /f');
    expect(m.nodos[DATOS]).toBeUndefined();
    // Los datos se borran DESPUÉS de parar y quitar el servicio (si no, los ficheros están en uso).
    expect(m.ev.indexOf(`rmdir ${DATOS}`)).toBeGreaterThan(m.ev.indexOf(`${EXE} uninstall`));
  });

  it('al borrar los datos, un enlace o junction que haya dentro se quita SIN seguirlo', async () => {
    const m = maquina();
    const fuera = join('C:', 'Windows', 'System32');
    m.nodos[DATOS] = { kind: 'dir', entries: ['trampa', 'a.txt'] };
    m.nodos[join(DATOS, 'trampa')] = { kind: 'link', entries: [fuera] };
    m.nodos[join(DATOS, 'a.txt')] = { kind: 'file' };
    m.nodos[fuera] = { kind: 'dir', entries: ['x.dll'] };
    m.nodos[join(fuera, 'x.dll')] = { kind: 'file' };
    await uninstallAll(base(m, { purgeData: true }));
    expect(m.ev).toContain(`unlink ${join(DATOS, 'trampa')}`);
    expect(m.ev.some((l) => l.includes(fuera))).toBe(false);
    expect(m.nodos[join(fuera, 'x.dll')]).toBeDefined();
  });

  it('quita de Program Files lo que NSIS no lista (sin seguir enlaces) y deja lo que NSIS borrará él', async () => {
    const m = maquina();
    await uninstallAll(base(m));
    for (const n of ['app', 'service', 'junction-plantada'])
      expect(m.nodos[join(INST, n)]).toBeUndefined();
    expect(m.ev).toContain(`unlink ${join(INST, 'junction-plantada')}`);
    // El Node en marcha, el desinstalador, el .exe que NSIS cierra antes de borrar y el log se quedan.
    for (const n of [
      'node',
      'installer',
      'uninstall.exe',
      'krakenos-window.exe',
      'install-error.log',
    ])
      expect(m.nodos[join(INST, n)]).toBeDefined();
  });

  it('no limpia Program Files si antes falló otro paso (queda para diagnosticar)', async () => {
    const m = maquina();
    const run = async (cmd: string, args: string[]) =>
      cmd === 'certutil' ? { code: 5, stdout: 'Acceso denegado' } : m.run(cmd, args);
    await expect(uninstallAll(base(m, { run }))).rejects.toThrow();
    expect(m.nodos[join(INST, 'app')]).toBeDefined();
  });

  it('una junction que lstat ve como carpeta pero cuyo realpath cae fuera NO se recorre: se quita solo ella', async () => {
    const m = maquina();
    const fuera = join('C:', 'Windows', 'System32');
    m.nodos[DATOS] = { kind: 'dir', entries: ['volumen', 'a.txt'] };
    m.nodos[join(DATOS, 'volumen')] = { kind: 'dir', entries: ['x.dll'], real: fuera };
    m.nodos[join(DATOS, 'volumen', 'x.dll')] = { kind: 'file' };
    m.nodos[join(DATOS, 'a.txt')] = { kind: 'file' };
    m.nodos[fuera] = { kind: 'dir', entries: ['x.dll'] };
    m.nodos[join(fuera, 'x.dll')] = { kind: 'file' };
    await uninstallAll(base(m, { purgeData: true }));
    expect(m.ev).toContain(`rmdir ${join(DATOS, 'volumen')}`);
    expect(m.ev.some((l) => l.includes('x.dll'))).toBe(false);
    expect(m.nodos[join(fuera, 'x.dll')]).toBeDefined();
    expect(m.nodos[DATOS]).toBeUndefined();
  });

  it('si Node no logra quitar un enlace, PowerShell lo quita (sin seguirlo, con la ruta por el entorno) y, si tampoco, falla nombrándolo', async () => {
    const trampa = join(DATOS, 'a&calc.exe %PATH% ^ | !');
    const armar = (psQuita: boolean) => {
      const m = maquina();
      const llamadas: { cmd: string; args: string[]; env?: Record<string, string> }[] = [];
      m.nodos[DATOS] = { kind: 'dir', entries: ['a&calc.exe %PATH% ^ | !'] };
      m.nodos[trampa] = { kind: 'link', entries: [] };
      const fs = {
        ...m.fs,
        unlink: async () => {},
        rmdir: async (p: string) => {
          if (p !== trampa) await m.fs.rmdir(p);
        },
      };
      const run = async (cmd: string, args: string[], o?: { env?: Record<string, string> }) => {
        if (o?.env?.KRAKENOS_RUTA) {
          llamadas.push({ cmd, args, env: o.env });
          if (psQuita) {
            delete m.nodos[trampa];
            quitarDeSuCarpeta(m.nodos, trampa);
          }
        }
        return m.run(cmd, args);
      };
      return { m, llamadas, opts: base(m, { purgeData: true, fs, run }) };
    };
    const a = armar(true);
    await uninstallAll(a.opts);
    expect(a.llamadas).toHaveLength(1);
    expect(a.llamadas[0]?.cmd).toBe('powershell.exe');
    expect(a.llamadas[0]?.env?.KRAKENOS_RUTA).toBe(trampa);
    // la ruta (con &, %, ^, |, !) NO viaja en los argumentos: solo por el entorno del hijo
    expect(a.llamadas[0]?.args.join(' ')).not.toContain('calc');
    expect(a.m.ev.some((l) => l.startsWith('cmd.exe'))).toBe(false);
    const b = armar(false);
    await expect(uninstallAll(b.opts)).rejects.toThrow(/no se pudo quitar.*calc/);
  });

  it('una entrada que readdir lista pero cuyo lstat da ENOENT (junction por volumen) se quita con PowerShell, y si sigue listada falla nombrándola', async () => {
    const vol = join(DATOS, 'junction-volumen');
    const armar = (psQuita: boolean) => {
      const m = maquina();
      m.nodos[DATOS] = { kind: 'dir', entries: ['junction-volumen'] };
      m.nodos[vol] = { kind: 'link', entries: [] };
      const fs = {
        ...m.fs,
        lstat: async (p: string) => {
          if (p === vol) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
          return m.fs.lstat(p);
        },
        unlink: async () => {},
        rmdir: async (p: string) => {
          if (p !== vol) await m.fs.rmdir(p);
        },
      };
      const run = async (cmd: string, args: string[], o?: { env?: Record<string, string> }) => {
        if (o?.env?.KRAKENOS_RUTA === vol && psQuita) {
          delete m.nodos[vol];
          (m.nodos[DATOS] as { entries: string[] }).entries = [];
        }
        return m.run(cmd, args);
      };
      return base(m, { purgeData: true, fs, run });
    };
    await uninstallAll(armar(true));
    await expect(uninstallAll(armar(false))).rejects.toThrow(/no se pudo quitar.*junction-volumen/);
  });

  it('si la propia carpeta de datos resuelve fuera (junction en la raíz), no se entra: se quita solo el punto', async () => {
    const m = maquina();
    const fuera = join('C:', 'Users');
    m.nodos[DATOS] = { kind: 'dir', entries: ['x.txt'], real: fuera };
    m.nodos[join(DATOS, 'x.txt')] = { kind: 'file' };
    await uninstallAll(base(m, { purgeData: true }));
    expect(borrados(m.ev).filter((l) => l.includes(DATOS))).toEqual([`rmdir ${DATOS}`]);
  });

  it('la comparación de la ruta real no distingue mayúsculas ni separadores', async () => {
    const m = maquina();
    m.nodos[DATOS] = { kind: 'dir', entries: ['a.txt'], real: 'c:\\programdata\\krakenos' };
    m.nodos[join(DATOS, 'a.txt')] = { kind: 'file' };
    await uninstallAll(base(m, { purgeData: true }));
    expect(m.ev).toContain(`unlink ${join(DATOS, 'a.txt')}`);
  });

  it('solo limpia Program Files si installDir es exactamente %ProgramFiles%\\KrakenOS (sin mayúsculas)', async () => {
    const otra = join('C:', 'Program Files', 'Common Files');
    const m = maquina();
    m.nodos[otra] = { kind: 'dir', entries: ['dll'] };
    m.nodos[join(otra, 'dll')] = { kind: 'file' };
    const avisos: string[] = [];
    await uninstallAll(base(m, { installDir: otra, log: (l: string) => avisos.push(l) }));
    expect(borrados(m.ev).filter((l) => l.includes(otra))).toEqual([]);
    expect(m.nodos[join(otra, 'dll')]).toBeDefined();
    expect(avisos.join('\n')).toContain(otra);

    const m2 = maquina();
    await uninstallAll(base(m2, { programFiles: 'c:\\PROGRAM FILES\\' }));
    expect(m2.nodos[join(INST, 'app')]).toBeUndefined();
  });

  it('con purgeData no borra una carpeta que no lleva la marca de KrakenOS en HKLM', async () => {
    const m = maquina();
    const run = async (cmd: string, args: string[]) =>
      [cmd, ...args].join(' ').includes('/v DataDir') ? { code: 1, stdout: '' } : m.run(cmd, args);
    const avisos: string[] = [];
    await uninstallAll(base(m, { purgeData: true, run, log: (l: string) => avisos.push(l) }));
    expect(borrados(m.ev).filter((l) => l.includes(DATOS))).toEqual([]);
    expect(m.nodos[DATOS]).toBeDefined();
    expect(avisos.join('\n')).toContain(DATOS);
  });

  it('dice dónde quedan los datos cuando se conservan', async () => {
    const m = maquina();
    const avisos: string[] = [];
    await uninstallAll(base(m, { log: (l: string) => avisos.push(l) }));
    expect(avisos.join('\n')).toContain(DATOS);
  });
});

describe('installer-hooks.nsh (desinstalar)', () => {
  const nsh = readFileSync(
    resolve(__dirname, '../../../../packaging/windows/installer-hooks.nsh'),
    'utf8',
  );
  const macro = (n: string) => nsh.split(`!macro ${n}`)[1]?.split('!macroend')[0] ?? '';

  it('PREUNINSTALL lanza post-install.mjs uninstall ANTES de que NSIS borre nada, y en actualización solo para el servicio', () => {
    const m = macro('NSIS_HOOK_PREUNINSTALL');
    expect(m).toMatch(/post-install\.mjs" uninstall/);
    expect(m).toMatch(/\$UpdateMode = 1/);
    expect(m).toMatch(/--update/);
  });

  it('borrar los datos solo con /PURGEDATA o con la casilla de Tauri, y el interruptor no se pierde en silencio', () => {
    const m = macro('NSIS_HOOK_PREUNINSTALL');
    expect(m).toMatch(/GetOptions\} \$CMDLINE "\/PURGEDATA"/);
    expect(m).toMatch(/\$DeleteAppDataCheckboxState = 1/);
    expect(m).toMatch(/--purge-data/);
  });

  it('un fallo de la desinstalación aborta ANTES de que NSIS borre nada y no se pierde el log', () => {
    const m = macro('NSIS_HOOK_PREUNINSTALL');
    expect(m).toMatch(/\$\{If\} \$0 != 0[\s\S]*DetailPrint[\s\S]*Abort/);
    // el log del instalador solo se borra en POSTUNINSTALL, que un Abort no alcanza
    expect(m).not.toMatch(/install-error\.log/);
  });

  it('POSTUNINSTALL no usa RMDir /r (en CI siguió una junction plantada y borró lo de fuera): solo el log y la carpeta vacía', () => {
    const m = macro('NSIS_HOOK_POSTUNINSTALL');
    expect(m).not.toMatch(/RMDir \/r/);
    expect(m).toMatch(/\$UpdateMode <> 1/);
    expect(m).toMatch(/\$PROGRAMFILES64/);
    expect(m).toMatch(/Delete "\$INSTDIR\\install-error\.log"/);
    expect(m).toMatch(/RMDir "\$INSTDIR"/);
  });

  it('el subcomando uninstall lee --purge-data y --update y usa uninstallAll', () => {
    const sub = readFileSync(
      resolve(__dirname, '../../../../packaging/windows/installer/post-install.mjs'),
      'utf8',
    );
    expect(sub).toMatch(/uninstallAll/);
    expect(sub).toMatch(/--purge-data/);
    expect(sub).toMatch(/--update/);
  });
});
