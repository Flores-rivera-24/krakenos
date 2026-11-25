import { basename, dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
// prettier-ignore
// @ts-expect-error — script de utilidad en JS puro (fuera del tsconfig del agente).
import { adminDirOf, checkTaskSddl, grantStateAccess, installTaskNode, keepInstaller, prepareAdminDir, registerUpdateTasks, taskSddl, updateTaskXml } from '../../../../packaging/windows/installer/update-setup.mjs';
// prettier-ignore
// @ts-expect-error — script de utilidad en JS puro (fuera del tsconfig del agente).
import { uninstallAll } from '../../../../packaging/windows/installer/steps.mjs';

/** Carpeta solo-Administradores y tareas de SYSTEM de la actualización desde la app, con `run`/`fs` inyectados. */

const PD = join('C:', 'ProgramData');
const ADMIN = adminDirOf(PD);
const INST = join('C:', 'Program Files', 'KrakenOS');
const SID = 'S-1-5-80-1-2-3-4-5';
const BASE_SDDL = 'D:P(A;;FA;;;SY)(A;;FA;;;BA)';

type Ev = string;
interface Nodo {
  kind: 'dir' | 'link' | 'file';
  entries?: string[];
  text?: string;
}

function fakeFs(ev: Ev[], nodos: Record<string, Nodo> = {}) {
  const enoent = () => Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  const alta = (p: string) => {
    const padre = nodos[dirname(p)];
    if (padre?.entries && !padre.entries.includes(basename(p))) padre.entries.push(basename(p));
  };
  const baja = (p: string) => {
    delete nodos[p];
    const padre = nodos[dirname(p)];
    if (padre?.entries) padre.entries = padre.entries.filter((n) => n !== basename(p));
  };
  return {
    lstat: async (p: string) => {
      const n = nodos[p];
      if (!n) throw enoent();
      return {
        isSymbolicLink: () => n.kind === 'link',
        isDirectory: () => n.kind === 'dir',
        isFile: () => n.kind === 'file',
        nlink: 1,
      };
    },
    readdir: async (p: string) => nodos[p]?.entries ?? [],
    mkdir: async (p: string, o?: { recursive?: boolean }) => {
      ev.push(`mkdir${o?.recursive ? ' -p' : ''} ${p}`);
      if (!o?.recursive && nodos[p]) throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' });
      nodos[p] ??= { kind: 'dir', entries: [] };
    },
    readFile: async (p: string) => {
      const n = nodos[p];
      if (n?.kind !== 'file') throw enoent();
      return n.text as string;
    },
    copyFile: async (a: string, b: string) => {
      ev.push(`copy ${a} ${b}`);
      if (nodos[a]?.kind !== 'file') throw enoent();
      nodos[b] = { ...(nodos[a] as Nodo) };
      alta(b);
    },
    rename: async (a: string, b: string) => {
      ev.push(`rename ${a} ${b}`);
      nodos[b] = nodos[a] as Nodo;
      baja(a);
      alta(b);
    },
    rm: async (p: string) => {
      ev.push(`rm ${p}`);
      baja(p);
    },
    rmdir: async (p: string) => {
      ev.push(`rmdir ${p}`);
      baja(p);
    },
    unlink: async (p: string) => {
      ev.push(`unlink ${p}`);
      baja(p);
    },
  };
}

/** Lectura de ACL de un despliegue bueno (SYSTEM y Administradores); `dueno` y `marca` para las carpetas ajenas. */
function fakeRun(
  ev: Ev[],
  opt: { dueno?: string; marca?: boolean; sddl?: string; code?: number } = {},
) {
  const envs: Record<string, string>[] = [];
  const rehechas = new Set<string>();
  const run = async (cmd: string, args: string[], o?: { env?: Record<string, string> }) => {
    const linea = [cmd, ...args].join(' ');
    ev.push(linea);
    if (o?.env) envs.push(o.env);
    if (cmd === 'reg.exe' && args[0] === 'query')
      return opt.marca
        ? { code: 0, stdout: `    AdminDir    REG_SZ    ${ADMIN}\r\n` }
        : { code: 1, stdout: '' };
    if (cmd === 'powershell.exe' && linea.includes('RegisterTask'))
      return { code: opt.code ?? 0, stdout: `SDDL:${opt.sddl ?? o?.env?.KR_SDDL}` };
    const rehecha = /SetAccessControl\('([^']*)'/.exec(linea)?.[1];
    if (rehecha) rehechas.add(rehecha);
    if (cmd === 'powershell.exe') {
      const dir = /GetAccessControl\('([^']*)'\)/.exec(linea)?.[1] ?? '';
      return {
        code: 0,
        stdout: [
          `OWNER:${opt.dueno && !rehechas.has(dir) ? opt.dueno : 'S-1-5-32-544'}`,
          // La carpeta nueva de ProgramData hereda Users hasta que se rehace su DACL.
          ...(rehechas.has(dir) || opt.marca
            ? []
            : ['S-1-5-32-545|ReadAndExecute, Synchronize|Allow|True']),
          'S-1-5-18|FullControl|Allow|False',
          'S-1-5-32-544|FullControl|Allow|False',
          ...(/estado$/.test(dir) && ev.some((l) => l.includes('/grant:r') && l.includes(SID))
            ? [`${SID}|ReadAndExecute, Synchronize|Allow|False`]
            : []),
        ].join('\r\n'),
      };
    }
    return { code: 0, stdout: '' };
  };
  return { run, envs };
}

describe('updateTaskXml', () => {
  const base = {
    nodeExe: 'C:\\A & B\\node.exe',
    script: 'C:\\P\\actualizar.mjs',
    workDir: 'C:\\W',
  };
  const x = updateTaskXml({ ...base, recover: false });

  it('corre con batería y no se para al desenchufar, y no se solapa', () => {
    expect(x).toContain('<DisallowStartIfOnBatteries>false<');
    expect(x).toContain('<StopIfGoingOnBatteries>false<');
    expect(x).toContain('<MultipleInstancesPolicy>IgnoreNew<');
    expect(x).toContain('<ExecutionTimeLimit>PT2H<');
    expect(x).toContain('<UserId>S-1-5-18<');
    expect(x).toContain('<RunLevel>HighestAvailable<');
    expect(x).toContain('<Enabled>true<');
    expect(x).not.toContain('Trigger');
  });

  it('escapa las rutas y pasa el script entre comillas, sin --recuperar', () => {
    expect(x).toContain('<Command>C:\\A &amp; B\\node.exe</Command>');
    expect(x).toContain('<Arguments>&quot;C:\\P\\actualizar.mjs&quot;</Arguments>');
    expect(x).not.toContain('--recuperar');
  });

  it('recover: BootTrigger con retraso de un minuto y --recuperar', () => {
    const r = updateTaskXml({ ...base, recover: true });
    expect(r).toContain('<BootTrigger><Enabled>true</Enabled><Delay>PT1M</Delay></BootTrigger>');
    expect(r).toContain('actualizar.mjs&quot; --recuperar</Arguments>');
  });
});

describe('taskSddl y checkTaskSddl', () => {
  it('taskSddl lleva la ACE del servicio solo si hay servicio', () => {
    expect(taskSddl(SID)).toBe(`${BASE_SDDL}(A;;GRGX;;;${SID})`);
    expect(taskSddl()).toBe(BASE_SDDL);
  });

  it.each(['GRGX', 'FRFX', '0x1200a9'])('acepta SY/BA FA + servicio con %s', (r) =>
    expect(checkTaskSddl(`${BASE_SDDL}(A;;${r};;;${SID})`, SID)).toBe(''),
  );

  it('acepta lo que lee Windows (PAI, SIDs completos) y sin servicio', () => {
    expect(checkTaskSddl('D:PAI(A;;FA;;;S-1-5-32-544)(A;;FA;;;S-1-5-18)', undefined)).toBe('');
  });

  it.each(['GA', 'GRGW', 'FA', 'GRGXWD', 'FW', 'WO', 'SD', 'DC'])(
    'rechaza al servicio con %s',
    (r) => expect(checkTaskSddl(`${BASE_SDDL}(A;;${r};;;${SID})`, SID)).not.toBe(''),
  );

  it('rechaza una ACE de Users (BU) o de Authenticated Users (AU), con o sin servicio', () => {
    for (const s of ['BU', 'AU', 'WD', 'S-1-5-32-545']) {
      expect(checkTaskSddl(`${BASE_SDDL}(A;;GRGX;;;${s})`, undefined)).not.toBe('');
      expect(checkTaskSddl(`${BASE_SDDL}(A;;GRGX;;;${SID})(A;;GRGX;;;${s})`, SID)).not.toBe('');
    }
  });

  it('rechaza el servicio en la tarea Recuperar, una denegación, una ACE que falta y una repetida', () => {
    expect(checkTaskSddl(`${BASE_SDDL}(A;;GRGX;;;${SID})`, undefined)).not.toBe('');
    expect(checkTaskSddl(`${BASE_SDDL}(D;;GRGX;;;${SID})`, SID)).not.toBe('');
    expect(checkTaskSddl('D:P(A;;FA;;;SY)', undefined)).not.toBe('');
    expect(checkTaskSddl(`${BASE_SDDL}(A;;FA;;;SY)`, undefined)).not.toBe('');
    expect(checkTaskSddl('', SID)).not.toBe('');
  });
});

describe('registerUpdateTasks', () => {
  const args = {
    installDir: INST,
    adminDir: ADMIN,
    nodeExe: join(ADMIN, 'bin', 'node-aaa.exe'),
    serviceSid: SID,
  };

  it('pasa XML y SDDL por el entorno (nunca en el script) y registra Actualizar y Recuperar', async () => {
    const ev: Ev[] = [];
    const { run, envs } = fakeRun(ev);
    await registerUpdateTasks({ ...args, run });
    const ps = ev.filter((l) => l.includes('RegisterTask'));
    expect(ps).toHaveLength(2);
    expect(ps[0]).toContain(
      "RegisterTask('Actualizar', $env:KR_XML, 6, 'SYSTEM', $null, 5, $env:KR_SDDL)",
    );
    expect(ps[1]).toContain(
      "RegisterTask('Recuperar', $env:KR_XML, 6, 'SYSTEM', $null, 5, $env:KR_SDDL)",
    );
    expect(
      ps.every(
        (l) => l.includes("GetFolder('\\KrakenOS')") && l.includes('GetSecurityDescriptor(4)'),
      ),
    ).toBe(true);
    expect(ps.some((l) => l.includes('<Task') || l.includes('D:P('))).toBe(false);
    expect(envs[0]?.KR_SDDL).toBe(taskSddl(SID));
    expect(envs[1]?.KR_SDDL).toBe(taskSddl());
    expect(envs[0]?.KR_XML).toContain(join(INST, 'installer', 'actualizar.mjs'));
    expect(envs[0]?.KR_XML).toContain(`<Command>${args.nodeExe}</Command>`);
    expect(envs[0]?.KR_XML).not.toContain('--recuperar');
    expect(envs[1]?.KR_XML).toContain('--recuperar');
  });

  it('falla si la DACL que quedó no es la esperada', async () => {
    const ev: Ev[] = [];
    const { run } = fakeRun(ev, { sddl: `${BASE_SDDL}(A;;GRGX;;;BU)` });
    await expect(registerUpdateTasks({ ...args, run })).rejects.toThrow(/Actualizar.*BU|BU/);
  });

  it('falla si PowerShell sale distinto de 0 o no devuelve la DACL', async () => {
    await expect(
      registerUpdateTasks({ ...args, run: fakeRun([], { code: 1 }).run }),
    ).rejects.toThrow();
    await expect(
      registerUpdateTasks({ ...args, run: fakeRun([], { sddl: '' }).run }),
    ).rejects.toThrow(/DACL/);
  });
});

describe('grantStateAccess', () => {
  it('da solo lectura y ejecución del servicio sobre estado\\ y lo verifica', async () => {
    const ev: Ev[] = [];
    await grantStateAccess({
      adminDir: ADMIN,
      serviceSid: SID,
      run: fakeRun(ev, { marca: true }).run,
    });
    expect(ev[0]).toBe(`icacls ${join(ADMIN, 'estado')} /grant:r *${SID}:(OI)(CI)RX`);
    expect(ev.some((l) => l.includes('GetAccessControl'))).toBe(true);
  });
});

describe('prepareAdminDir', () => {
  it('carpeta nueva: ACL de una vez, marca AdminDir después y subcarpetas', async () => {
    const ev: Ev[] = [];
    await prepareAdminDir({ adminDir: ADMIN, run: fakeRun(ev).run, fs: fakeFs(ev) });
    const acl = ev.findIndex((l) => l.includes(`SetAccessControl('${ADMIN}'`));
    const marca = ev.indexOf(
      `reg.exe add HKLM\\SOFTWARE\\KrakenOS /v AdminDir /t REG_SZ /d ${ADMIN} /f`,
    );
    expect(acl).toBeGreaterThan(-1);
    expect(marca).toBeGreaterThan(acl);
    expect(ev[ev.indexOf(`mkdir ${ADMIN}`)]).toBeDefined();
    for (const s of ['bin', 'actualizacion', 'instaladores', 'logs', 'estado'])
      expect(ev).toContain(`mkdir -p ${join(ADMIN, s)}`);
    expect(ev.indexOf(`mkdir -p ${join(ADMIN, 'bin')}`)).toBeGreaterThan(marca);
  });

  it('rechaza una carpeta ajena con contenido y rehace una ajena vacía', async () => {
    const ajena = { [ADMIN]: { kind: 'dir', entries: ['x'] } } as Record<string, Nodo>;
    const ev: Ev[] = [];
    await expect(
      prepareAdminDir({ adminDir: ADMIN, run: fakeRun(ev).run, fs: fakeFs(ev, ajena) }),
    ).rejects.toThrow(/no es de un despliegue/);
    expect(ev.some((l) => l.startsWith('reg.exe add'))).toBe(false);
    const vacia = { [ADMIN]: { kind: 'dir', entries: [] } } as Record<string, Nodo>;
    const ev2: Ev[] = [];
    await prepareAdminDir({ adminDir: ADMIN, run: fakeRun(ev2).run, fs: fakeFs(ev2, vacia) });
    expect(ev2).toContain(`rmdir ${ADMIN}`);
    expect(ev2).toContain(`mkdir ${ADMIN}`);
  });

  it('con la marca y dueño de fiar la conserva, sin recrearla, y repone lo de dentro', async () => {
    const nodos = {
      [ADMIN]: { kind: 'dir', entries: ['bin'] },
      [join(ADMIN, 'bin')]: { kind: 'dir', entries: [] },
    } as Record<string, Nodo>;
    const ev: Ev[] = [];
    await prepareAdminDir({
      adminDir: ADMIN,
      run: fakeRun(ev, { marca: true }).run,
      fs: fakeFs(ev, nodos),
    });
    expect(ev).not.toContain(`rmdir ${ADMIN}`);
    expect(ev).toContain(`icacls ${join(ADMIN, 'bin')} /reset /T /L`);
  });

  it('rechaza un enlace o junction, en la raíz o dentro', async () => {
    for (const nodos of [
      { [ADMIN]: { kind: 'link' } },
      { [ADMIN]: { kind: 'dir', entries: ['bin'] }, [join(ADMIN, 'bin')]: { kind: 'link' } },
    ] as Record<string, Nodo>[]) {
      const ev: Ev[] = [];
      await expect(
        prepareAdminDir({
          adminDir: ADMIN,
          run: fakeRun(ev, { marca: true }).run,
          fs: fakeFs(ev, nodos),
        }),
      ).rejects.toThrow(/enlace|junction/);
      expect(ev.some((l) => l.startsWith('reg.exe add'))).toBe(false);
    }
  });
});

describe('installTaskNode', () => {
  const sha = (t: string) => createHash('sha256').update(t).digest('hex');
  const origen = join(INST, 'node', 'node.exe');
  const bin = join(ADMIN, 'bin');
  const destino = join(bin, `node-${sha('NODO').slice(0, 12)}.exe`);

  it('copia a un temporal, renombra y borra los node-*.exe viejos', async () => {
    const viejo = join(bin, 'node-000000000000.exe');
    const nodos = {
      [origen]: { kind: 'file', text: 'NODO' },
      [bin]: { kind: 'dir', entries: ['node-000000000000.exe', 'otro.txt'] },
      [viejo]: { kind: 'file', text: 'VIEJO' },
      [join(bin, 'otro.txt')]: { kind: 'file', text: '' },
    } as Record<string, Nodo>;
    const ev: Ev[] = [];
    const r = await installTaskNode({ installDir: INST, adminDir: ADMIN, fs: fakeFs(ev, nodos) });
    expect(r).toBe(destino);
    expect(ev).toContain(`copy ${origen} ${destino}.tmp`);
    expect(ev).toContain(`rename ${destino}.tmp ${destino}`);
    expect(ev).toContain(`rm ${viejo}`);
    expect(ev).not.toContain(`rm ${join(bin, 'otro.txt')}`);
  });

  it('no toca la copia con la misma suma y rehace la que no casa', async () => {
    const nodos = {
      [origen]: { kind: 'file', text: 'NODO' },
      [bin]: { kind: 'dir', entries: [basename(destino)] },
      [destino]: { kind: 'file', text: 'NODO' },
    } as Record<string, Nodo>;
    const ev: Ev[] = [];
    await installTaskNode({ installDir: INST, adminDir: ADMIN, fs: fakeFs(ev, nodos) });
    expect(ev.some((l) => l.startsWith('copy') || l.startsWith('rename'))).toBe(false);
    nodos[destino] = { kind: 'file', text: 'MANIPULADO' };
    const ev2: Ev[] = [];
    await installTaskNode({ installDir: INST, adminDir: ADMIN, fs: fakeFs(ev2, nodos) });
    expect(ev2).toContain(`rename ${destino}.tmp ${destino}`);
    expect(nodos[destino]?.text).toBe('NODO');
  });

  it('un node viejo en uso (el rm falla) no impide terminar', async () => {
    const viejo = join(bin, 'node-000000000000.exe');
    const nodos = {
      [origen]: { kind: 'file', text: 'NODO' },
      [bin]: { kind: 'dir', entries: ['node-000000000000.exe'] },
      [viejo]: { kind: 'file', text: 'VIEJO' },
    } as Record<string, Nodo>;
    const fs = fakeFs([], nodos);
    const rm = fs.rm;
    fs.rm = async (p: string) => {
      if (p === viejo) throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' });
      return rm(p);
    };
    await expect(installTaskNode({ installDir: INST, adminDir: ADMIN, fs })).resolves.toBe(destino);
  });
});

describe('keepInstaller', () => {
  const dir = join(ADMIN, 'instaladores');
  const f = (v: string) => join(dir, `KrakenOS-Setup-${v}-x64.exe`);
  const ORIGEN = join('C:', 'Users', 'x', 'Downloads', 'KrakenOS-Setup-0.0.2-x64.exe');

  it('copia con temporal y renombre, y deja la actual y la más alta de las demás', async () => {
    const nodos = {
      [ORIGEN]: { kind: 'file', text: 'EXE' },
      [dir]: { kind: 'dir', entries: ['0.0.1', '0.0.3', '0.0.10'].map((v) => basename(f(v))) },
      [f('0.0.1')]: { kind: 'file', text: '' },
      [f('0.0.3')]: { kind: 'file', text: '' },
      [f('0.0.10')]: { kind: 'file', text: '' },
    } as Record<string, Nodo>;
    const ev: Ev[] = [];
    await keepInstaller({
      exePath: ORIGEN,
      version: '0.0.2',
      adminDir: ADMIN,
      fs: fakeFs(ev, nodos),
    });
    expect(ev).toContain(`copy ${ORIGEN} ${f('0.0.2')}.tmp`);
    expect(ev).toContain(`rename ${f('0.0.2')}.tmp ${f('0.0.2')}`);
    expect([...(nodos[dir]?.entries ?? [])].sort()).toEqual(
      ['0.0.10', '0.0.2'].map((v) => basename(f(v))).sort(),
    );
  });

  it('no copia sobre sí mismo (la vuelta atrás corre desde ese fichero) y poda igual', async () => {
    const nodos = {
      [dir]: { kind: 'dir', entries: ['0.0.1', '0.0.2', '0.0.3'].map((v) => basename(f(v))) },
      [f('0.0.1')]: { kind: 'file', text: '' },
      [f('0.0.2')]: { kind: 'file', text: '' },
      [f('0.0.3')]: { kind: 'file', text: '' },
    } as Record<string, Nodo>;
    const ev: Ev[] = [];
    await keepInstaller({
      exePath: f('0.0.2'),
      version: '0.0.2',
      adminDir: ADMIN,
      fs: fakeFs(ev, nodos),
    });
    expect(ev.some((l) => l.startsWith('copy'))).toBe(false);
    expect([...(nodos[dir]?.entries ?? [])].sort()).toEqual(
      ['0.0.2', '0.0.3'].map((v) => basename(f(v))),
    );
  });
});

describe('uninstallAll y KrakenOS-admin', () => {
  const EXE = join(INST, 'service', 'KrakenOS-service.exe');
  function armar(conMarca: boolean) {
    const ev: Ev[] = [];
    const nodos: Record<string, Nodo> = {
      [ADMIN]: { kind: 'dir', entries: ['bin'] },
      [join(ADMIN, 'bin')]: { kind: 'dir', entries: [] },
    };
    const run = async (cmd: string, args: string[]) => {
      ev.push([cmd, ...args].join(' '));
      if (cmd === 'sc.exe') return { code: 1060, stdout: '' };
      if (cmd === 'reg.exe' && args[0] === 'query' && args.includes('AdminDir'))
        return conMarca
          ? { code: 0, stdout: `    AdminDir    REG_SZ    ${ADMIN}\r\n` }
          : { code: 1, stdout: '' };
      return { code: 0, stdout: '' };
    };
    const fs = { ...fakeFs(ev, nodos), realpath: async (p: string) => p };
    return {
      ev,
      nodos,
      opts: {
        run,
        fs,
        dataDir: join(PD, 'KrakenOS'),
        serviceExe: EXE,
        installDir: INST,
        programFiles: join('C:', 'Program Files'),
        removeLinks: async () => {},
        sleep: async () => {},
      },
    };
  }

  it('con la marca AdminDir quita la carpeta y la marca; sin marca no la toca', async () => {
    const a = armar(true);
    await uninstallAll(a.opts);
    expect(a.nodos[ADMIN]).toBeUndefined();
    expect(a.ev).toContain('reg.exe delete HKLM\\SOFTWARE\\KrakenOS /v AdminDir /f');
    const b = armar(false);
    await uninstallAll(b.opts);
    expect(b.nodos[ADMIN]).toBeDefined();
    expect(b.ev.some((l) => l.includes('AdminDir /f'))).toBe(false);
  });

  it('con --update no la toca', async () => {
    const a = armar(true);
    await uninstallAll({ ...a.opts, update: true });
    expect(a.nodos[ADMIN]).toBeDefined();
    expect(a.ev.some((l) => l.includes('AdminDir'))).toBe(false);
  });
});
