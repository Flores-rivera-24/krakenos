/**
 * Clave pública ed25519 con la que se verifican los manifiestos de las
 * actualizaciones por paquete. La privada vive solo en el secreto de CI
 * `UPDATE_SIGNING_KEY`.
 *
 * MARCADOR: esta clave es de relleno (su privada se descartó). Nada firmado la
 * verificará; la real la pone la Task 6 de US-291a.
 */
export const UPDATE_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAf+ykNvPwJrynmdcwtWX2g5sFWz0Umo1l1Ge8tCsbtMI=
-----END PUBLIC KEY-----
`;
