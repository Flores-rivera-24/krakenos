import { statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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
 * arranque aunque la ACL del directorio lo restrinja. El instalador de Windows (que fijaría
 * la ACL) aún no existe: hasta entonces el chequeo se declara «no aplica» y el arranque avisa
 * con `secretPermissionsStartupNotice`, en vez de mentir.
 */
export function secretPermissionsApply(platform: NodeJS.Platform = process.platform): boolean {
  return platform !== 'win32';
}

export interface SecretPermissionsNotice {
  message: string;
}

export interface SecretFolders {
  /** Raíz del estado (`KRAKENOS_DATA_DIR`): contiene `prisma/`, `data/`, `var/` y `keys/`. */
  stateRoot: string;
  /** Rutas con secretos ya resueltas (claves, `.env`, base, copias…); solo se nombran las de fuera. */
  candidates: string[];
}

const WIN = path.win32;

/** ¿`child` cuelga de `parent`? Windows no distingue mayúsculas, y `win32.relative` tampoco. */
function isInside(parent: string, child: string): boolean {
  const rel = WIN.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !WIN.isAbsolute(rel));
}

/** El log se pega en issues públicas: el prefijo del perfil no debe llevar el nombre de usuario. */
function hideProfile(p: string, home: string): string {
  return home !== '' && isInside(home, p)
    ? `%USERPROFILE%${WIN.relative(home, p) === '' ? '' : '\\' + WIN.relative(home, p)}`
    : p;
}

/**
 * Aviso de arranque según la plataforma: `null` donde el chequeo de modos aplica. En Windows
 * NO se lee la ACL (la salida de `icacls` está localizada y sería frágil): se declara que no
 * se ha comprobado quién puede leer las carpetas con secretos, nombrando la raíz del estado y
 * solo las rutas con secretos que caen fuera de ella.
 */
export function secretPermissionsStartupNotice(
  platform: NodeJS.Platform,
  folders: SecretFolders,
  homedir: string = os.homedir(),
): SecretPermissionsNotice | null {
  if (secretPermissionsApply(platform)) return null;
  const outside: string[] = [];
  for (const c of folders.candidates) {
    const known = outside.some((o) => WIN.relative(o, c) === '');
    if (!isInside(folders.stateRoot, c) && !known) outside.push(c);
  }
  const names = [folders.stateRoot, ...outside].map((p) => hideProfile(p, homedir));
  return {
    message:
      'En Windows los modos de fichero (0600/0700) no restringen nada y no se ha comprobado ni ' +
      `fijado quién puede leer estas carpetas con secretos (${names.join(', ')}): otras cuentas ` +
      'del equipo podrían leer las claves, la base y las copias. Mueve la raíz de datos ' +
      '(`KRAKENOS_DATA_DIR`) dentro del perfil de la cuenta que corre el agente, o restringe ' +
      'esas carpetas con `icacls`.',
  };
}

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
