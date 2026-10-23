import { resolve } from 'node:path';

/**
 * Dónde guarda las claves el agente **de verdad**: las fija el entorno
 * (`JWT_PRIVATE_KEY_PATH`, `JWT_PUBLIC_KEY_PATH`, `SECRETBOX_KEY_PATH`), y en Docker
 * viven en el volumen (`/data/keys`), no en `./keys`. Es el único punto por el que
 * pasan la copia y la restauración.
 */
export interface KeyPathsSource {
  jwtPrivateKeyPath: string;
  jwtPublicKeyPath: string;
  secretboxKeyPath: string;
}

export interface KeyFilePaths {
  jwtPrivate: string;
  jwtPublic: string;
  secretbox: string;
}

/**
 * Nombres **lógicos** de estas claves dentro del archivo de copia (`keys/<fichero>`).
 * El formato del archivo no cambia: solo se mapean a la ruta real al guardar/restaurar.
 */
export const KEY_ENTRY_NAMES: Record<keyof KeyFilePaths, string> = {
  jwtPrivate: 'keys/jwt-private.pem',
  jwtPublic: 'keys/jwt-public.pem',
  secretbox: 'keys/secretbox.key',
};

export function keyFilePaths(source: KeyPathsSource): KeyFilePaths {
  return {
    jwtPrivate: resolve(source.jwtPrivateKeyPath),
    jwtPublic: resolve(source.jwtPublicKeyPath),
    secretbox: resolve(source.secretboxKeyPath),
  };
}
