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
 * cuando la config viene de systemd). `stat` es inyectable para tests.
 */
export function checkSecretFilePermissions(
  paths: string[],
  stat: StatMode = defaultStat,
): SecretFileWarning[] {
  const warnings: SecretFileWarning[] = [];
  for (const path of paths) {
    const mode = stat(path);
    if (mode !== null && isGroupOrWorldAccessible(mode)) {
      warnings.push({ path, mode: (mode & 0o777).toString(8).padStart(3, '0') });
    }
  }
  return warnings;
}
