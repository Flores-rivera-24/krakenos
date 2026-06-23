import { randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Token de configuración out-of-band para `/setup/init` (US-81, F10).
 *
 * `/setup/init` es público mientras no haya admin: en una instalación recién
 * arrancada, el **primer** cliente que alcanza el agente reclamaba la cuenta admin
 * (ventana de "first-boot" en LAN/VPN). Para cerrarla, al primer arranque sin
 * usuarios el agente genera un token aleatorio y lo **imprime en el log/CLI**
 * (canal out-of-band: solo quien tiene acceso al servidor lo ve) y `/setup/init`
 * lo exige. Tras crear el admin el token se invalida.
 *
 * Singleton en memoria (patrón de `rate-limit-store`/`mfa-token-store`): el token
 * vive solo durante la ventana de setup y desaparece al completar o reiniciar.
 */

let token: string | null = null;

export const setupToken = {
  /** Genera el token si aún no existe y lo devuelve (idempotente). */
  ensure(): string {
    if (!token) token = randomBytes(24).toString('base64url');
    return token;
  },

  /** ¿Hay un token de setup activo (setup pendiente)? */
  isActive(): boolean {
    return token !== null;
  },

  /** Compara en tiempo constante el candidato con el token activo. */
  verify(candidate: string): boolean {
    if (!token) return false;
    const a = Buffer.from(token);
    const b = Buffer.from(candidate);
    return a.length === b.length && timingSafeEqual(a, b);
  },

  /** Invalida el token (tras completar el setup). */
  clear(): void {
    token = null;
  },

  /** Reinicia el estado (útil en tests). */
  reset(): void {
    token = null;
  },
};
