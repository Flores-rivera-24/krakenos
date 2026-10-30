/**
 * Presupuesto de tamaño de la carpeta empaquetada (US-284). El valor medido y el tope
 * viven en `size-budget.json`, por plataforma: `maxMb` = medido + 5 %, redondeado arriba.
 */
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Tamaño en MB (1 MB = 1048576 bytes) de los ficheros bajo `dir`, sin seguir enlaces.
 * @param {string} dir
 * @returns {Promise<number>}
 */
export async function dirSizeMb(dir) {
  let bytes = 0;
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const ruta = join(dir, e.name);
    if (e.isDirectory()) bytes += (await dirSizeMb(ruta)) * 1048576;
    else if (e.isFile()) bytes += (await stat(ruta)).size;
  }
  return bytes / 1048576;
}

/**
 * Lanza, nombrando las dos cifras, si el paquete pesa más que el tope.
 * @param {number} sizeMb
 * @param {{ maxMb: number, measuredMb: number }} budget
 * @returns {void}
 */
export function checkSize(sizeMb, budget) {
  if (sizeMb > budget.maxMb) {
    throw new Error(
      `El paquete pesa ${sizeMb.toFixed(1)} MB y el tope es ${budget.maxMb} MB (medido al fijarlo: ${budget.measuredMb} MB). ` +
        'Si el aumento es legítimo, mide de nuevo y actualiza scripts/package/size-budget.json.',
    );
  }
}
