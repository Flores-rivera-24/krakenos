import { createPrivateKey, createPublicKey, createSign, createVerify } from 'node:crypto';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ensureSecretboxKey,
  generateJwtKeys,
  KeysExistError,
  type KeyPaths,
  keyPathsFromDir,
  keyPathsFromEnv,
  NoCurrentKeysError,
  rotateJwtKeys,
  runKeysCli,
} from '../../src/crypto/keys.js';
import { Keyring } from '../../src/auth/keyring.js';
import { loadOrCreateSecretbox } from '../../src/config/secretbox.js';

/**
 * `crypto/keys.ts`: el par RS256 de los JWT, la clave de secretbox y la rotación, hechos
 * con Node (sin `openssl`). Lo delicado es la ROTACIÓN: el script de bash escribía la
 * pública nueva antes de mover la privada y un corte entre las dos dejaba un par
 * desemparejado (nadie podía iniciar sesión).
 */

let root: string;
let n = 0;
function paths(): KeyPaths {
  const dir = join(root, `k${n++}`);
  return keyPathsFromDir(dir);
}
const mode = (p: string) => (statSync(p).mode & 0o777).toString(8);

/** ¿La privada firma y la pública verifica? (el par está emparejado) */
function emparejado(privatePem: string, publicPem: string): boolean {
  const firma = createSign('RSA-SHA256').update('x').sign(createPrivateKey(privatePem));
  return createVerify('RSA-SHA256').update('x').verify(createPublicKey(publicPem), firma);
}
const leer = (p: string) => readFileSync(p, 'utf8');
const sinTemporales = (dir: string) =>
  readdirSync(dir).filter((f) => f.endsWith('.tmp') || f.startsWith('.'));

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'kraken-keys-'));
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('generateJwtKeys', () => {
  it('genera un par RS256 de 2048 bits (PKCS#8 / SPKI), emparejado, con modos 600/644', () => {
    const p = paths();
    const r = generateJwtKeys(p);
    expect(r.secretbox).toBe(true);
    const priv = leer(p.privatePath);
    const pub = leer(p.publicPath);
    // PKCS#8 (`BEGIN PRIVATE KEY`, no `BEGIN RSA PRIVATE KEY`). La armadura se arma por
    // partes: escrita entera en el fuente, el escáner de secretos la tomaría por una clave filtrada.
    expect(priv.startsWith(`-----BEGIN ${'PRIVATE'} KEY-----`)).toBe(true);
    expect(pub.startsWith('-----BEGIN PUBLIC KEY-----')).toBe(true);
    const k = createPrivateKey(priv);
    expect(k.asymmetricKeyType).toBe('rsa');
    expect(k.asymmetricKeyDetails?.modulusLength).toBe(2048);
    expect(emparejado(priv, pub)).toBe(true);
    if (process.platform !== 'win32') {
      // Windows no tiene bits de modo POSIX (stat devuelve 666): solo se comprueban en POSIX.
      expect(mode(p.privatePath)).toBe('600');
      expect(mode(p.publicPath)).toBe('644');
      expect(mode(p.secretboxPath)).toBe('600');
    }
    expect(sinTemporales(join(p.privatePath, '..'))).toEqual([]);
  });

  it('el llavero del agente lo acepta y firma/verifica con él', () => {
    const p = paths();
    generateJwtKeys(p);
    const ring = new Keyring({ privateKey: leer(p.privatePath), publicKey: leer(p.publicPath) });
    expect(ring.kids()).toHaveLength(1);
    expect(emparejado(ring.signingPrivateKey(), ring.signingPublicKey())).toBe(true);
  });

  // Windows no tiene umask ni bits de modo POSIX: no hay nada que comprobar.
  it.skipIf(process.platform === 'win32')('la clave privada nace 600 aunque el umask sea 0', () => {
    const p = paths();
    const antes = process.umask(0);
    try {
      generateJwtKeys(p);
    } finally {
      process.umask(antes);
    }
    expect(mode(p.privatePath)).toBe('600');
    expect(mode(p.secretboxPath)).toBe('600');
  });

  it('el secretbox es de 32 bytes en base64 y el agente lo carga', () => {
    const p = paths();
    generateJwtKeys(p);
    expect(Buffer.from(leer(p.secretboxPath).trim(), 'base64')).toHaveLength(32);
    const box = loadOrCreateSecretbox(p.secretboxPath);
    expect(box.decrypt(box.encrypt('hola'))).toBe('hola');
  });

  it('no sobrescribe un par existente', () => {
    const p = paths();
    generateJwtKeys(p);
    const antes = leer(p.privatePath);
    expect(() => generateJwtKeys(p)).toThrow(KeysExistError);
    expect(leer(p.privatePath)).toBe(antes);
  });

  it('no sobrescribe la clave de secretbox existente, ni regenera ante otro error que ENOENT', () => {
    const p = paths();
    mkdirSync(join(p.privatePath, '..'), { recursive: true });
    writeFileSync(p.secretboxPath, 'clave-existente');
    generateJwtKeys(p);
    expect(leer(p.secretboxPath)).toBe('clave-existente');
    // Un directorio donde debería estar el fichero: se deja, no se «arregla».
    const q = paths();
    mkdirSync(q.secretboxPath, { recursive: true });
    expect(ensureSecretboxKey(q.secretboxPath)).toBe(false);
    expect(statSync(q.secretboxPath).isDirectory()).toBe(true);
  });
});

describe('rotateJwtKeys', () => {
  it('genera un par nuevo, deja la pública anterior como .prev y los tokens viejos siguen verificando', () => {
    const p = paths();
    generateJwtKeys(p);
    const oldPriv = leer(p.privatePath);
    const oldPub = leer(p.publicPath);
    rotateJwtKeys(p);
    const newPriv = leer(p.privatePath);
    const newPub = leer(p.publicPath);
    expect(newPriv).not.toBe(oldPriv);
    expect(newPub).not.toBe(oldPub);
    expect(leer(p.prevPublicPath)).toBe(oldPub);
    expect(emparejado(newPriv, newPub)).toBe(true);
    if (process.platform !== 'win32') {
      // Windows no tiene bits de modo POSIX (stat devuelve 666): solo se comprueban en POSIX.
      expect(mode(p.privatePath)).toBe('600');
      expect(mode(p.publicPath)).toBe('644');
      expect(mode(p.prevPublicPath)).toBe('644');
    }
    expect(sinTemporales(join(p.privatePath, '..'))).toEqual([]);
    // Durante el solape el llavero verifica con las dos.
    const ring = new Keyring({ privateKey: newPriv, publicKey: newPub }, [leer(p.prevPublicPath)]);
    expect(ring.kids()).toHaveLength(2);
    // Lo firmado con la privada ANTERIOR verifica con la pública previa.
    const firma = createSign('RSA-SHA256').update('x').sign(createPrivateKey(oldPriv));
    expect(
      createVerify('RSA-SHA256')
        .update('x')
        .verify(createPublicKey(leer(p.prevPublicPath)), firma),
    ).toBe(true);
  });

  it('sin par actual no hay nada que rotar', () => {
    const p = paths();
    expect(() => rotateJwtKeys(p)).toThrow(NoCurrentKeysError);
    mkdirSync(join(p.privatePath, '..'), { recursive: true });
    writeFileSync(p.privatePath, 'solo la privada');
    expect(() => rotateJwtKeys(p)).toThrow(NoCurrentKeysError);
  });

  it('el orden es: .prev → privada → pública, y TODO lo nuevo está escrito antes de tocar el par vigente', () => {
    const p = paths();
    generateJwtKeys(p);
    const destinos: string[] = [];
    // En el momento del primer rename ya existen los temporales nuevos y el par vigente
    // sigue siendo el viejo.
    const oldPriv = leer(p.privatePath);
    const oldPub = leer(p.publicPath);
    rotateJwtKeys(p, {
      rename: (from, to) => {
        if (destinos.length === 0) {
          expect(leer(p.privatePath)).toBe(oldPriv);
          expect(leer(p.publicPath)).toBe(oldPub);
          expect(sinTemporales(join(p.privatePath, '..')).length).toBeGreaterThanOrEqual(4);
        }
        destinos.push(to);
        renameSync(from, to);
      },
    });
    expect(destinos).toEqual([p.prevPublicPath, p.privatePath, p.publicPath]);
  });

  it.each([
    ['la .prev', 0],
    ['la privada nueva', 1],
    ['la pública nueva', 2],
  ])('si falla al publicar %s, el par anterior sigue emparejado y usable', (_nombre, fallaEn) => {
    const p = paths();
    generateJwtKeys(p);
    const oldPriv = leer(p.privatePath);
    const oldPub = leer(p.publicPath);
    let llamada = 0;
    expect(() =>
      rotateJwtKeys(p, {
        rename: (from, to) => {
          if (llamada++ === fallaEn)
            throw Object.assign(new Error('disco lleno'), { code: 'ENOSPC' });
          renameSync(from, to);
        },
      }),
    ).toThrow(/disco lleno/);
    // El par vigente es EXACTAMENTE el anterior y está emparejado: se puede iniciar sesión.
    expect(leer(p.privatePath)).toBe(oldPriv);
    expect(leer(p.publicPath)).toBe(oldPub);
    expect(emparejado(leer(p.privatePath), leer(p.publicPath))).toBe(true);
    // Windows no tiene bits de modo POSIX (stat devuelve 666): solo se comprueba en POSIX.
    if (process.platform !== 'win32') expect(mode(p.privatePath)).toBe('600');
    // Sin temporales ni copias de la privada olvidados.
    expect(sinTemporales(join(p.privatePath, '..'))).toEqual([]);
  });

  // El fallo se provoca quitando el permiso de escritura del directorio (chmod 500), que Windows no honra.
  it.skipIf(process.platform === 'win32')(
    'un fallo al escribir los temporales (antes de tocar nada) deja el par intacto',
    () => {
      // root ignora los permisos de directorio: ahí no se puede provocar el fallo así.
      if (process.getuid?.() === 0) return;
      const p = paths();
      generateJwtKeys(p);
      const oldPriv = leer(p.privatePath);
      const dir = join(p.privatePath, '..');
      chmodSync(dir, 0o500); // sin escritura: el primer temporal ya no se puede crear
      try {
        expect(() => rotateJwtKeys(p)).toThrow();
      } finally {
        chmodSync(dir, 0o700);
      }
      expect(leer(p.privatePath)).toBe(oldPriv);
      expect(emparejado(leer(p.privatePath), leer(p.publicPath))).toBe(true);
      expect(sinTemporales(dir)).toEqual([]);
    },
  );

  it('si ni siquiera se puede restaurar la privada, el error lo dice con todas las letras', () => {
    const p = paths();
    generateJwtKeys(p);
    const dir = join(p.privatePath, '..');
    let llamada = 0;
    expect(() =>
      rotateJwtKeys(p, {
        rename: (from, to) => {
          if (++llamada < 3) return renameSync(from, to);
          // Falla la publicación de la pública y, a la vez, desaparece la copia de la
          // privada vieja (lo único con lo que se podía deshacer).
          for (const f of readdirSync(dir)) {
            if (f.startsWith('.jwt-private.pem.') && f.endsWith('.tmp')) rmSync(join(dir, f));
          }
          throw new Error('fallo');
        },
      }),
    ).toThrow(/NO se pudo restaurar/);
  });
});

describe('keyPathsFromEnv', () => {
  it('sin variables: <agente>/keys; con KRAKENOS_KEYS_DIR: ese directorio', () => {
    expect(keyPathsFromEnv({}, '/opt/agente').privatePath).toBe(
      resolve('/opt/agente/keys/jwt-private.pem'),
    );
    expect(keyPathsFromEnv({ KRAKENOS_KEYS_DIR: '/etc/k' }, '/opt/agente').secretboxPath).toBe(
      resolve('/etc/k/secretbox.key'),
    );
  });

  it('con JWT_PRIVATE_KEY_PATH y JWT_PUBLIC_KEY_PATH (la imagen de Docker) respeta esas rutas', () => {
    const p = keyPathsFromEnv(
      {
        JWT_PRIVATE_KEY_PATH: '/data/keys/jwt-private.pem',
        JWT_PUBLIC_KEY_PATH: '/data/keys/jwt-public.pem',
      },
      '/app',
    );
    expect(p.privatePath).toBe(resolve('/data/keys/jwt-private.pem'));
    expect(p.publicPath).toBe(resolve('/data/keys/jwt-public.pem'));
    expect(p.secretboxPath).toBe(resolve('/data/keys/secretbox.key'));
    expect(p.prevPublicPath).toBe(resolve('/data/keys/jwt-public.prev.pem'));
    // Con una sola de las dos no se adivina: se usa el directorio por defecto.
    expect(keyPathsFromEnv({ JWT_PRIVATE_KEY_PATH: '/x/y.pem' }, '/app').privatePath).toBe(
      resolve('/app/keys/jwt-private.pem'),
    );
  });
});

describe('runKeysCli', () => {
  function cli(args: string[], env: NodeJS.ProcessEnv) {
    const out: string[] = [];
    const err: string[] = [];
    const code = runKeysCli(args, env, '/no/se/usa', {
      out: (l) => out.push(l),
      err: (l) => err.push(l),
    });
    return { code, out: out.join('\n'), err: err.join('\n') };
  }

  it('gen crea las claves; repetirlo falla con 1 y el mensaje de siempre', () => {
    const dir = join(root, `cli${n++}`);
    const env = { KRAKENOS_KEYS_DIR: dir };
    const a = cli(['gen'], env);
    expect(a.code).toBe(0);
    expect(a.out).toContain(`Claves RS256 generadas en ${dir}`);
    expect(a.out).toContain('Clave de cifrado de secretos generada');
    const b = cli(['gen'], env);
    expect(b.code).toBe(1);
    expect(b.err).toContain('Las claves ya existen');
    expect(emparejado(leer(join(dir, 'jwt-private.pem')), leer(join(dir, 'jwt-public.pem')))).toBe(
      true,
    );
  });

  it('rotate rota e imprime los pasos siguientes; sin par, error 1', () => {
    const dir = join(root, `cli${n++}`);
    const env = { KRAKENOS_KEYS_DIR: dir };
    expect(cli(['rotate'], env).code).toBe(1);
    cli(['gen'], env);
    const r = cli(['rotate'], env);
    expect(r.code).toBe(0);
    expect(r.out).toContain('Rotación lista');
    expect(r.out).toContain('JWT_PREVIOUS_PUBLIC_KEY_PATHS=./keys/jwt-public.prev.pem');
    expect(statSync(join(dir, 'jwt-public.prev.pem')).isFile()).toBe(true);
  });

  it('un subcomando desconocido da el uso y 2', () => {
    const r = cli(['nada'], { KRAKENOS_KEYS_DIR: join(root, `cli${n++}`) });
    expect(r.code).toBe(2);
    expect(r.err).toContain('Uso:');
  });
});
