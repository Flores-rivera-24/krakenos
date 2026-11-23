/**
 * WinSW 2.12.0, el envoltorio que corre `node.exe` como servicio de Windows. El binario se baja de la
 * release exacta y se verifica contra una suma fijada en `winsw.json` en cada build; nunca `latest`.
 * La suma se contrastó con una segunda fuente independiente (el manifiesto `winsw` del bucket Main
 * de Scoop, que lleva la misma para WinSW-x64.exe v2.12.0).
 * `WinSW-x64.exe` es autocontenido (18 MB, no pide .NET Framework).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const PLANTILLA = join(AQUI, '..', '..', 'packaging', 'windows', 'KrakenOS-service.xml.in');

/** @type {{ version: string, url: string, sha256: string }} */
export const WINSW = JSON.parse(await readFile(join(AQUI, 'winsw.json'), 'utf8'));

/** @param {Buffer} bytes @param {string} expectedSha256 */
export function verifyWinswBinary(bytes, expectedSha256) {
  const real = createHash('sha256').update(bytes).digest('hex');
  if (real !== expectedSha256)
    throw new Error(`WinSW no verifica: esperaba ${expectedSha256}, obtuve ${real}`);
}

/** @param {{ port: number }} opts */
export function renderWinswXml({ port }) {
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error(`puerto inválido para el servicio: ${port}`);
  return renderPlantilla(String(port));
}

let plantilla;
function renderPlantilla(port) {
  plantilla ??= readFileSync(PLANTILLA, 'utf8');
  return plantilla.replaceAll('@PORT@', port);
}

/**
 * Deja `service\KrakenOS-service.exe` (WinSW verificado) y `.xml` (mismo nombre: así lo encuentra WinSW)
 * en `payloadDir`. `cacheDir` guarda la descarga; si ya hay una, se verifica igual (una caché alterada
 * tiene que fallar por la suma, no colarse).
 * @param {string} payloadDir @param {string} cacheDir @param {number} port
 */
export async function installWinsw(payloadDir, cacheDir, port) {
  const cache = join(cacheDir, `WinSW-x64-${WINSW.version}.exe`);
  let bytes;
  try {
    bytes = await readFile(cache);
  } catch {
    const r = await fetch(WINSW.url);
    if (!r.ok) throw new Error(`no se pudo bajar WinSW (${r.status}): ${WINSW.url}`);
    bytes = Buffer.from(await r.arrayBuffer());
    verifyWinswBinary(bytes, WINSW.sha256);
    await mkdir(cacheDir, { recursive: true });
    await writeFile(cache, bytes);
  }
  verifyWinswBinary(bytes, WINSW.sha256);
  const dir = join(payloadDir, 'service');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'KrakenOS-service.exe'), bytes);
  await writeFile(join(dir, 'KrakenOS-service.xml'), renderWinswXml({ port }));
}
