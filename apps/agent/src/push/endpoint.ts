/**
 * Guardia del endpoint de una suscripción Web Push (AUD3-01, US-227).
 *
 * El `endpoint` de una suscripción **lo elige el cliente** y el agente le hará un
 * `POST` con la notificación. Sin validarlo, cualquier cuenta autenticada podía
 * (a) recibir las alertas de seguridad del hogar en un servidor propio y (b) usar
 * al agente como SSRF ciega contra la LAN que gestiona.
 *
 * Un push service es **siempre** un servicio público sobre `https` (FCM, Mozilla,
 * Apple): aquí la política de egress correcta NO es la LAN-friendly del resto de
 * la app, sino la **estricta** (`blockPrivate: true`), porque una IP privada o
 * loopback nunca es un destino legítimo de Web Push.
 *
 * `allowUnresolvable` queda en `true` a propósito: un nombre que no resuelve no es
 * un objetivo de SSRF (no hay a dónde ir) y el envío fallará solo; lo que se
 * bloquea es un nombre que **sí** resuelve a un destino interno.
 */
import { assertHostAllowed, EgressBlockedError, type EgressPolicy } from '../net/egress.js';

/** Política estricta: un push service jamás vive en la LAN del usuario. */
export const PUSH_EGRESS_POLICY: EgressPolicy = { blockPrivate: true };

/**
 * Valida el endpoint de una suscripción. Lanza `EgressBlockedError` si el esquema
 * no es `https`, si lleva credenciales embebidas o si el host resuelve a un
 * destino no permitido. Devuelve la `URL` parseada.
 */
export async function assertPushEndpointAllowed(
  endpoint: string,
  policy: EgressPolicy = PUSH_EGRESS_POLICY,
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new EgressBlockedError('URL inválida', endpoint);
  }
  if (url.protocol !== 'https:') {
    throw new EgressBlockedError(
      `el endpoint de push debe ser https (recibido: ${url.protocol})`,
      endpoint,
    );
  }
  if (url.username || url.password) {
    throw new EgressBlockedError('el endpoint no puede incluir credenciales embebidas', endpoint);
  }
  await assertHostAllowed(url.hostname, policy, { allowUnresolvable: true });
  return url;
}
