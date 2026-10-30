/**
 * Renombrado con reintento para Windows (US-284). Una carpeta recién escrita puede quedar
 * bloqueada unos segundos (antivirus, indexador) y `rename` falla con EPERM/EBUSY/EACCES;
 * al repetir, pasa. En otras plataformas ese error es real: un solo intento.
 */
import { rename as fsRename } from 'node:fs/promises';

const TRANSITORIOS = new Set(['EPERM', 'EBUSY', 'EACCES']);

/**
 * @param {string} origen
 * @param {string} destino
 * @param {{ rename?: (a: string, b: string) => Promise<void>, win?: boolean,
 *           dormir?: (ms: number) => Promise<void>, log?: (m: string) => void,
 *           maxMs?: number }} [opts]
 * @returns {Promise<void>}
 */
export async function renombrarConReintento(origen, destino, opts = {}) {
  const {
    rename = fsRename,
    win = process.platform === 'win32',
    dormir = (ms) => new Promise((r) => setTimeout(r, ms)),
    log = console.log,
    maxMs = 15_000,
  } = opts;
  let esperado = 0;
  for (let intento = 1; ; intento++) {
    try {
      await rename(origen, destino);
      return;
    } catch (e) {
      const espera = Math.min(250 * 2 ** (intento - 1), 2_000);
      if (!win || !TRANSITORIOS.has(e?.code) || esperado + espera > maxMs) throw e;
      log(`    rename ${origen} -> ${destino}: ${e.code}; reintento ${intento} en ${espera} ms`);
      await dormir(espera);
      esperado += espera;
    }
  }
}
