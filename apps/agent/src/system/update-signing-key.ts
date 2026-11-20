/**
 * Clave pública ed25519 con la que se verifican los manifiestos de las
 * actualizaciones por paquete. La privada vive solo en el secreto de CI
 * `UPDATE_SIGNING_KEY` (y en la copia que guarda el dueño). Generada el 2026-11-19.
 * Cambiarla deja sin poder actualizarse desde la app a toda instalación que lleve la anterior.
 */
export const UPDATE_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAHlpvbUXnHM19Gw+YtdDA94QlJMLsNb7eYuopomHQwVQ=
-----END PUBLIC KEY-----
`;
