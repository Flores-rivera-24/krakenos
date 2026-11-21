import { X509Certificate } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensureLocalCa } from '../../src/crypto/local-ca.js';
// prettier-ignore
// @ts-expect-error — script de utilidad en JS puro (fuera del tsconfig del agente).
import { setKey } from '../../../../scripts/package/launchers/first-run.mjs';
// prettier-ignore
// @ts-expect-error — script de utilidad en JS puro (fuera del tsconfig del agente).
import { grantServiceAccess, installService, localHostname, pickPort, prepareDataDir, registerRenewalTask, runInstall, setupTls, stopService, virtualAccountSid, waitHealthy, withXmlPort, writeWindowJson } from '../../../../packaging/windows/installer/steps.mjs';
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
    rmdir: async (p: string) => {
      events.push(`rmdir ${p}`);
      delete nodos[p];
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
