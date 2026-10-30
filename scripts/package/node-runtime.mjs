/**
 * Verificación del Node que se empaqueta (US-284). Dos barreras independientes:
 * la firma GPG del `SHASUMS256.txt` (la hace el equipo de releases de Node) y la suma
 * sha256 del archivo contra ese fichero ya firmado. Sin la primera, la segunda solo
 * prueba que el archivo coincide con una lista que pudo cambiar quien cambió el archivo.
 *
 * Todo es puro o recibe su efecto inyectado (`run`), para probarlo sin red ni gpg.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

/**
 * Llavero de los publicadores de Node (`nodejs/release-keys`, solo claves activas),
 * fijado al commit 481637f (2026-09-01) y a su sha256: la rama `main` de ese repo
 * cambia cuando rotan claves, y un llavero que se mueve solo no es una raíz de
 * confianza. Con ese llavero verifica la firma de `SHASUMS256.txt` de v24.21.0.
 */
export const NODE_KEYRING = {
  url: 'https://raw.githubusercontent.com/nodejs/release-keys/481637f813e912c4aa3622d7964ab426c97b8e8d/gpg-only-active-keys/pubring.kbx',
  sha256: '140f2ad5260fd62773b6243ce8e1d3009645d558f121b8262c55e383dc285932',
};

/**
 * Suma esperada de `fileName` en el texto de un `SHASUMS256.txt` (`<hex>  <nombre>`).
 * Lanza si no aparece o aparece más de una vez: con dos líneas, elegir una sería adivinar.
 * @param {string} shasumsText
 * @param {string} fileName
 * @returns {string}
 */
export function expectedSha256(shasumsText, fileName) {
  const sumas = [];
  for (const linea of shasumsText.split('\n')) {
    const m = /^([0-9a-f]{64})\s+\*?(.+?)\s*$/.exec(linea);
    if (m && m[2] === fileName) sumas.push(m[1]);
  }
  if (sumas.length === 0) throw new Error(`${fileName} no aparece en SHASUMS256.txt`);
  if (sumas.length > 1)
    throw new Error(`${fileName} aparece ${sumas.length} veces en SHASUMS256.txt`);
  return /** @type {string} */ (sumas[0]);
}

/**
 * @param {string} filePath
 * @param {string} expected
 * @returns {Promise<void>}
 */
export async function assertSha256(filePath, expected) {
  const hash = createHash('sha256');
  for await (const trozo of createReadStream(filePath)) hash.update(trozo);
  const real = hash.digest('hex');
  if (real !== expected) {
    throw new Error(`sha256 de ${filePath} no coincide: esperada ${expected}, real ${real}`);
  }
}

/**
 * `keyring`, `signature` y `file` son nombres de archivo DENTRO de `dir`, que es el cwd de gpg.
 * Se usa `gpgv` y no `gpg`: la opción `use-keyboxd` del `common.conf` del usuario (gpg 2.4 la
 * crea al configurarse) hace que `gpg` ignore `--keyring` y falle con «No public key»; `gpgv`
 * existe justo para verificar contra un llavero dado y no lee esa configuración.
 * El gpgv de Git for Windows (MSYS) no admite una ruta con letra de unidad en `--keyring`,
 * y sin el `./` busca el archivo en su homedir.
 * @param {{ run: (cmd: string, args: string[], opts: { cwd: string }) => Promise<{ code: number, stderr: string }>,
 *           dir: string, keyring: string, signature: string, file: string }} opts
 * @returns {Promise<void>}
 */
export async function verifySignature({ run, dir, keyring, signature, file }) {
  for (const nombre of [keyring, signature, file]) {
    if (/[/\\]/.test(nombre)) {
      throw new Error(`Se esperaba un nombre de archivo dentro de ${dir}, no una ruta: ${nombre}`);
    }
  }
  const { code, stderr } = await run('gpgv', ['--keyring', `./${keyring}`, signature, file], {
    cwd: dir,
  });
  if (code !== 0)
    throw new Error(`La firma de ${file} no verifica (gpgv salió con ${code}): ${stderr}`);
}
