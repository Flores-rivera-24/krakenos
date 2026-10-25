import { statSync } from 'node:fs';

/**
 * Verificación de permisos de los ficheros con secretos al arrancar (US-79, F8).
 *
 * Las credenciales de integración (SSH/REST/SNMP/MQTT, `TAPO_*`…) viven en `.env`
 * y la clave privada RS256 en `keys/`. No hay almacén de secretos ni cifrado en
 * reposo: la única protección es el permiso de fichero del SO. Un `.env` o una
 * clave privada legibles por **grupo u otros** filtran todas las credenciales de
 * la red ante cualquier usuario local. Este chequeo avisa (no bloquea) si algún
 * fichero con secretos es accesible más allá de su propietario.
 */

/**
 * ¿Tiene sentido mirar los bits de `mode`? En Windows `stat().mode` es una ficción (siempre
 * 0666/0444 según el atributo de solo lectura): avisaría de «legible por todos» en CADA
 * arranque aunque la ACL del directorio lo restrinja. Allí los permisos los fija el
 * instalador con ACL (US-280), así que el chequeo se declara «no aplica» en vez de mentir.
 */
export function secretPermissionsApply(platform: NodeJS.Platform = process.platform): boolean {
  return platform !== 'win32';
}

/** Texto de log cuando el chequeo no aplica. */
export const SECRET_PERMISSIONS_NOT_APPLICABLE =
  'Permisos de los ficheros con secretos: no aplica en Windows (los fija el instalador con ACL).';

/** ¿El modo concede lectura/escritura a grupo u otros (más laxo que 0600)? */
export function isGroupOrWorldAccessible(mode: number): boolean {
  return (mode & 0o077) !== 0;
}

export interface SecretFileWarning {
  path: string;
  /** Modo octal de 3 dígitos (p. ej. `644`). */
  mode: string;
}

/** Lee el modo de un fichero, o `null` si no existe / no se puede leer. */
type StatMode = (path: string) => number | null;

const defaultStat: StatMode = (path) => {
  try {
    return statSync(path).mode;
  } catch {
    return null;
  }
};

/**
 * Revisa los permisos de los ficheros indicados y devuelve un aviso por cada uno
 * accesible por grupo u otros. Ignora los que no existen (p. ej. el `.env` no está
 * cuando la config viene de systemd). `stat` y `platform` son inyectables para tests; en
 * Windows no avisa de nada (ver `secretPermissionsApply`).
 */
export function checkSecretFilePermissions(
  paths: string[],
  stat: StatMode = defaultStat,
  platform: NodeJS.Platform = process.platform,
): SecretFileWarning[] {
  const warnings: SecretFileWarning[] = [];
  if (!secretPermissionsApply(platform)) return warnings;
  for (const path of paths) {
    const mode = stat(path);
    if (mode !== null && isGroupOrWorldAccessible(mode)) {
      warnings.push({ path, mode: (mode & 0o777).toString(8).padStart(3, '0') });
    }
  }
  return warnings;
}
