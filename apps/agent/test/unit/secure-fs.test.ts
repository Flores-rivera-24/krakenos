import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import type * as NodeFs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// `chmodSync` se anula para observar el modo con el que NACE el fichero: si el secreto se
// creara con el modo por defecto y se endureciera después con `chmod`, habría una ventana
// en la que otro usuario puede leerlo, y con el `chmod` real el test no la vería.
vi.mock('node:fs', async (original) => ({
  ...(await original<typeof NodeFs>()),
  chmodSync: vi.fn(),
}));

const {
  applyModeAndGroup,
  assertNotSymlink,
  commitTempFile,
  existsNoFollow,
  resolveGroupId,
  UnsafePathError,
  writeFileAtomic,
  writeTempFile,
} = await import('../../src/crypto/secure-fs.js');

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'kraken-securefs-'));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const mode = (p: string) => (statSync(p).mode & 0o777).toString(8);

describe('writeTempFile', () => {
  // Los bits de modo y el umask son POSIX: Windows no los tiene.
  it.skipIf(process.platform === 'win32')(
    'el fichero NACE con el modo pedido, sin depender de un chmod posterior (umask 0)',
    () => {
      const antes = process.umask(0);
      try {
        const tmp = writeTempFile(join(dir, 'clave.pem'), 'secreto', 0o600);
        expect(mode(tmp)).toBe('600');
        expect(readFileSync(tmp, 'utf8')).toBe('secreto');
      } finally {
        process.umask(antes);
      }
    },
  );

  it('se queda en el mismo directorio que el destino (el rename es atómico) y es oculto', () => {
    const tmp = writeTempFile(join(dir, 'otra.pem'), 'x', 0o644);
    expect(tmp.startsWith(join(dir, '.otra.pem.'))).toBe(true);
    expect(tmp.endsWith('.tmp')).toBe(true);
  });
});

describe('writeFileAtomic / commitTempFile', () => {
  it('publica el contenido completo y no deja temporales', () => {
    const sub = join(dir, 'atomico');
    mkdirSync(sub);
    writeFileAtomic(join(sub, 'a.pem'), 'uno', 0o644);
    writeFileAtomic(join(sub, 'a.pem'), 'dos', 0o644);
    expect(readFileSync(join(sub, 'a.pem'), 'utf8')).toBe('dos');
    expect(readdirSync(sub)).toEqual(['a.pem']);
  });

  it('un rename que falla borra el temporal y propaga el error', () => {
    const sub = join(dir, 'fallo');
    mkdirSync(sub);
    const tmp = writeTempFile(join(sub, 'a.pem'), 'x', 0o600);
    expect(() =>
      commitTempFile(tmp, join(sub, 'a.pem'), () => {
        throw new Error('nope');
      }),
    ).toThrow('nope');
    expect(readdirSync(sub)).toEqual([]);
  });

  it('REEMPLAZA un enlace simbólico en el destino en vez de escribir a través de él', () => {
    const sub = join(dir, 'enlace');
    mkdirSync(sub);
    const victima = join(sub, 'victima.txt');
    writeFileSync(victima, 'no me toques');
    symlinkSync(victima, join(sub, 'agent-key.pem'));
    writeFileAtomic(join(sub, 'agent-key.pem'), 'nuevo', 0o600);
    expect(readFileSync(victima, 'utf8')).toBe('no me toques');
    expect(readFileSync(join(sub, 'agent-key.pem'), 'utf8')).toBe('nuevo');
  });
});

describe('assertNotSymlink / existsNoFollow', () => {
  it('rechaza enlaces (también rotos) y acepta lo que no existe o es normal', () => {
    const sub = join(dir, 'sym');
    mkdirSync(sub);
    symlinkSync(join(sub, 'no-existe'), join(sub, 'roto'));
    expect(() => assertNotSymlink(join(sub, 'roto'))).toThrow(UnsafePathError);
    expect(() => assertNotSymlink(join(sub, 'nada'))).not.toThrow();
    writeFileSync(join(sub, 'f'), '');
    expect(() => assertNotSymlink(join(sub, 'f'))).not.toThrow();
    // Un enlace roto EXISTE (no se sigue): sin esto se «crearía» a través de él.
    expect(existsNoFollow(join(sub, 'roto'))).toBe(true);
    expect(existsNoFollow(join(sub, 'nada'))).toBe(false);
  });
});

describe('applyModeAndGroup', () => {
  it('fija el modo por descriptor y NO sigue un enlace simbólico', () => {
    const sub = join(dir, 'modo');
    mkdirSync(sub);
    const real = join(sub, 'real');
    writeFileSync(real, '', { mode: 0o600 });
    applyModeAndGroup(real, 0o640);
    expect(mode(real)).toBe('640');
    symlinkSync(real, join(sub, 'enlace'));
    // O_NOFOLLOW: abrir el enlace falla (ELOOP) en vez de tocar el destino.
    expect(() => applyModeAndGroup(join(sub, 'enlace'), 0o666)).toThrow();
    expect(mode(real)).toBe('640');
  });
});

describe('resolveGroupId', () => {
  it('acepta un id numérico, resuelve el grupo propio y falla con uno inexistente', () => {
    expect(resolveGroupId('1234')).toBe(1234);
    const gid = process.getgid?.();
    if (gid !== undefined) {
      // El grupo primario del usuario figura en /etc/group (o en NSS).
      const nombre = readFileSync('/etc/group', 'utf8')
        .split('\n')
        .map((l) => l.split(':'))
        .find((c) => Number(c[2]) === gid)?.[0];
      if (nombre) expect(resolveGroupId(nombre)).toBe(gid);
    }
    expect(() => resolveGroupId('grupo-que-no-existe-xyz')).toThrow(/no existe/);
  });
});
