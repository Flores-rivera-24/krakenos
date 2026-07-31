import { createHash } from 'node:crypto';

/**
 * Derivación de la credencial **Tapo/KLAP** (US-259) — pura y sin estado.
 *
 * El problema que resuelve: el backend `kasa` guardaba la **contraseña completa de
 * la cuenta TP-Link**, y esa cuenta no es solo de los enchufes — es la del portal
 * del fabricante, la misma que mucha gente reutiliza. Un volcado de la config (o
 * una copia de seguridad mal guardada) entregaba esa contraseña en claro.
 *
 * La observación que lo hace innecesario: **KLAP nunca usa el email ni la
 * contraseña**. Todo el handshake de tres pasos —verificación del servidor, clave
 * de sesión, IV y firma— se construye sobre un único valor derivado:
 *
 *     authHash = sha256( sha256(email) ‖ sha256(password) )
 *
 * (verificado en `kasa.transport.ts::authHash`/`handshake`). Así que se guarda
 * **eso** y no la credencial.
 *
 * ⚠️ **Qué NO es esto.** El `authHash` sigue siendo material sensible: quien lo
 * tenga controla los enchufes Tapo del hogar, porque es exactamente lo que el
 * protocolo pide. Lo que se gana es acotar el daño — se pierde el control de unos
 * enchufes, no la cuenta del fabricante ni las cuentas que compartan esa
 * contraseña—. Por eso se sigue cifrando en reposo con secretbox como cualquier
 * otro secreto: esto **complementa** ese cifrado, no lo sustituye.
 */

/** Hash de autenticación KLAP en hexadecimal (64 chars). */
export function deriveTapoAuthHash(email: string, password: string): string {
  const sha256 = (value: Buffer) => createHash('sha256').update(value).digest();
  return sha256(
    Buffer.concat([sha256(Buffer.from(email)), sha256(Buffer.from(password))]),
  ).toString('hex');
}

/**
 * ¿Tiene el valor la forma de un `authHash` ya derivado? Se usa para no volver a
 * derivar sobre algo que ya lo está y para validar lo que llega de `.env`, donde
 * el usuario lo escribe a mano.
 */
export function isTapoAuthHash(value: string): boolean {
  return /^[0-9a-f]{64}$/i.test(value);
}
