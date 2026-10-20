import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { generateSecretboxKey } from '../config/secretbox.js';
import {
  commitTempFile,
  existsNoFollow,
  removeQuietly,
  writeFileAtomic,
  writeTempFile,
} from './secure-fs.js';

/**
 * Claves de la instalación generadas con Node, sin bash ni `openssl` (US-277):
 *
 *   · el par RS256 de firma de JWT (PKCS#8 / SPKI, 2048 bits),
 *   · la clave de cifrado de secretos en reposo (secretbox, 32 bytes en base64),
 *   · la rotación del par con solape.
 *
 * Sustituye a `gen-keys.sh` y `rotate-keys.sh`. Los formatos son los mismos que
 * producían `openssl genpkey` y `openssl rsa -pubout`, así que las claves de una
 * instalación anterior se siguen leyendo sin migrar nada.
 */

/** Dónde vive cada fichero de claves. */
export interface KeyPaths {
  privatePath: string;
  publicPath: string;
  /** Pública anterior durante el solape de una rotación. */
  prevPublicPath: string;
  secretboxPath: string;
}

/** Rutas por defecto: los cuatro ficheros juntos en un directorio. */
export function keyPathsFromDir(dir: string): KeyPaths {
  return {
    privatePath: join(dir, 'jwt-private.pem'),
    publicPath: join(dir, 'jwt-public.pem'),
    prevPublicPath: join(dir, 'jwt-public.prev.pem'),
    secretboxPath: join(dir, 'secretbox.key'),
  };
}

/** El par ya existe: generar encima lo dejaría todas las sesiones sin verificar. */
export class KeysExistError extends Error {
  constructor(readonly dir: string) {
    super(`Las claves ya existen en ${dir} — abortando para no sobrescribir.`);
    this.name = 'KeysExistError';
  }
}

/** Falta el par actual: no hay nada que rotar. */
export class NoCurrentKeysError extends Error {
  constructor(readonly dir: string) {
    super(`No existe el par actual en ${dir}. Genera el primero con «node dist/keys.js gen».`);
    this.name = 'NoCurrentKeysError';
  }
}

/** Par RS256 de 2048 bits: privada PKCS#8 y pública SPKI, ambas en PEM. */
export function generateRsaPair(): { privatePem: string; publicPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  return { privatePem: privateKey, publicPem: publicKey };
}

const PRIVATE_MODE = 0o600;
const PUBLIC_MODE = 0o644;

function ensureKeysDir(path: string): void {
  // 0700 solo si lo crea esto: un directorio que ya existía (p. ej. el volumen de
  // Docker) conserva el suyo.
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
}

/**
 * Genera el par RS256 y, si falta, la clave de secretbox. Lanza {@link KeysExistError}
 * si la clave privada ya existe (nunca sobrescribe).
 *
 * La pública se publica ANTES que la privada: el criterio de «ya existe» es la privada,
 * así que un corte a medias deja un estado que se puede volver a generar, no una privada
 * sin su pública que nadie sabe emparejar.
 *
 * Devuelve qué se creó, para que el llamador lo cuente.
 */
export function generateJwtKeys(paths: KeyPaths): { jwt: true; secretbox: boolean } {
  if (existsNoFollow(paths.privatePath)) throw new KeysExistError(dirname(paths.privatePath));
  ensureKeysDir(paths.privatePath);
  const { privatePem, publicPem } = generateRsaPair();
  writeFileAtomic(paths.publicPath, publicPem, PUBLIC_MODE);
  writeFileAtomic(paths.privatePath, privatePem, PRIVATE_MODE);
  return { jwt: true, secretbox: ensureSecretboxKey(paths.secretboxPath) };
}

/**
 * Crea la clave de secretbox SOLO si el fichero no existe. Cualquier otro estado
 * (existe, es ilegible, es un directorio) se deja como está: regenerarla dejaría
 * ilegibles, sin error, todos los secretos ya cifrados en la base.
 * @returns `true` si la creó.
 */
export function ensureSecretboxKey(path: string): boolean {
  if (existsNoFollow(path)) return false;
  ensureKeysDir(path);
  writeFileAtomic(path, generateSecretboxKey().toString('base64'), PRIVATE_MODE);
  return true;
}

/** Operaciones de disco de la rotación, inyectables para provocar un fallo en un paso. */
export interface RotateOps {
  rename(from: string, to: string): void;
}

/**
 * Rota el par RS256 con solape (docs/jwt-key-rotation.md).
 *
 *   1. La clave privada nueva y la pública nueva se escriben a temporales.
 *   2. La pública ACTUAL pasa a `jwt-public.prev.pem` (verifica los tokens aún válidos).
 *   3. Se publican la privada y la pública nuevas (`rename`, atómico).
 *
 * Nada del par vigente se toca hasta que TODO lo nuevo está escrito: un fallo antes del
 * paso 3 deja el par anterior intacto. El `rotate-keys.sh` anterior escribía la pública
 * nueva ANTES de mover la privada, y un corte entre las dos dejaba un par desemparejado
 * (nadie podía iniciar sesión). Si falla la publicación de la pública, la privada
 * anterior se restaura.
 *
 * Un corte del PROCESO (no un error) justo entre los dos `rename` finales sigue dejando
 * una ventana de dos llamadas al sistema; con dos ficheros no hay forma de cerrarla del
 * todo sin cambiar el formato del par.
 */
export function rotateJwtKeys(paths: KeyPaths, ops: RotateOps = { rename: renameSync }): void {
  const dir = dirname(paths.privatePath);
  if (!existsNoFollow(paths.privatePath) || !existsNoFollow(paths.publicPath)) {
    throw new NoCurrentKeysError(dir);
  }
  const temps: string[] = [];
  const stage = (path: string, data: string | Buffer, mode: number): string => {
    const tmp = writeTempFile(path, data, mode);
    temps.push(tmp);
    return tmp;
  };
  try {
    const { privatePem, publicPem } = generateRsaPair();
    const newPrivate = stage(paths.privatePath, privatePem, PRIVATE_MODE);
    const newPublic = stage(paths.publicPath, publicPem, PUBLIC_MODE);
    const prev = stage(paths.prevPublicPath, readFileSync(paths.publicPath), PUBLIC_MODE);
    // Copia de la privada vigente para poder deshacer si la pública no se publica.
    const oldPrivate = stage(paths.privatePath, readFileSync(paths.privatePath), PRIVATE_MODE);

    ops.rename(prev, paths.prevPublicPath);
    ops.rename(newPrivate, paths.privatePath);
    try {
      ops.rename(newPublic, paths.publicPath);
    } catch (err) {
      // La privada ya es la nueva y la pública sigue siendo la vieja: se deshace (con el
      // `rename` real, no el inyectado: es el camino de vuelta, no el que se está probando).
      try {
        commitTempFile(oldPrivate, paths.privatePath);
      } catch (undoErr) {
        throw new Error(
          `la rotación falló y NO se pudo restaurar la clave privada anterior: el par de ${dir} ` +
            'puede quedar desemparejado. Restáurala a mano desde una copia.',
          { cause: new AggregateError([err, undoErr]) },
        );
      }
      throw err;
    }
  } finally {
    for (const tmp of temps) removeQuietly(tmp);
  }
}

/** Salida de la CLI (inyectable en tests). */
export interface CliIo {
  out(line: string): void;
  err(line: string): void;
}

/**
 * Rutas desde el entorno. Con `JWT_PRIVATE_KEY_PATH` y `JWT_PUBLIC_KEY_PATH` ambos fijados
 * (la imagen de Docker los fija) se respetan; si no, `KRAKENOS_KEYS_DIR` o `<agente>/keys`.
 */
export function keyPathsFromEnv(env: NodeJS.ProcessEnv, agentDir: string): KeyPaths {
  const priv = env.JWT_PRIVATE_KEY_PATH;
  const pub = env.JWT_PUBLIC_KEY_PATH;
  if (priv && pub) {
    const dir = dirname(resolve(priv));
    return {
      privatePath: resolve(priv),
      publicPath: resolve(pub),
      prevPublicPath: join(dirname(resolve(pub)), 'jwt-public.prev.pem'),
      secretboxPath: env.SECRETBOX_KEY_PATH
        ? resolve(env.SECRETBOX_KEY_PATH)
        : join(dir, 'secretbox.key'),
    };
  }
  const paths = keyPathsFromDir(resolve(env.KRAKENOS_KEYS_DIR || join(agentDir, 'keys')));
  if (env.SECRETBOX_KEY_PATH) paths.secretboxPath = resolve(env.SECRETBOX_KEY_PATH);
  return paths;
}

/**
 * `node dist/keys.js gen|rotate`. Devuelve el código de salida.
 * La misma interfaz que `gen-keys.sh` / `rotate-keys.sh`, que ejecutaba el instalador.
 */
export function runKeysCli(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  agentDir: string,
  io: CliIo,
): number {
  const command = args[0];
  const paths = keyPathsFromEnv(env, agentDir);
  const dir = dirname(paths.privatePath);
  try {
    if (command === 'gen') {
      const made = generateJwtKeys(paths);
      io.out(`Claves RS256 generadas en ${dir}`);
      if (made.secretbox) {
        io.out(`Clave de cifrado de secretos generada en ${paths.secretboxPath}`);
      }
      return 0;
    }
    if (command === 'rotate') {
      rotateJwtKeys(paths);
      io.out('Rotación lista:');
      io.out(`  · Clave de firma NUEVA: ${paths.privatePath} / ${paths.publicPath}`);
      io.out(`  · Clave PREVIA (solape): ${paths.prevPublicPath}`);
      io.out('');
      io.out('Siguiente:');
      io.out('  1) En el .env:  JWT_PREVIOUS_PUBLIC_KEY_PATHS=./keys/jwt-public.prev.pem');
      io.out('  2) Reinicia el agente.');
      io.out(`  3) Tras el solape (>= REFRESH_TOKEN_TTL), borra ${paths.prevPublicPath}, quita la`);
      io.out('     variable y reinicia. Ver docs/jwt-key-rotation.md.');
      return 0;
    }
    io.err('Uso: node dist/keys.js gen|rotate');
    return 2;
  } catch (err) {
    io.err(err instanceof Error ? err.message : String(err));
    return 1;
  }
}
