/**
 * Redacción de secretos en las URLs que van al log (US-231 · AUD3-08).
 *
 * Dos secretos viajan en la **query string** por razones de protocolo, no por
 * descuido:
 *
 *  - **`st`** — el token de stream de las cámaras (US-185). Ni hls.js ni el
 *    `<video>` nativo pueden añadir cabeceras a la carga de segmentos, así que el
 *    token va en `?st=`. Es de vida corta (300 s) y está acotado a una cámara,
 *    pero **da acceso al vídeo de una casa**.
 *  - **`token`** — el token de configuración del primer arranque (US-81), que
 *    aparece en la URL de `/setup?token=…`. Quien lo tenga puede reclamar el
 *    admin de una instalación recién montada.
 *
 * Fastify registra `req.url` tal cual, así que ambos acababan en el log — y la
 * plantilla de bug de US-218 **le pide al usuario que pegue ese log** en un issue
 * público de GitHub. Ahí es donde el secreto de vida corta se vuelve un problema.
 *
 * Puro y sin dependencias: se usa desde el serializador de pino y desde tests.
 */

/**
 * Nombres de parámetro cuyo valor nunca debe aparecer en el log. Se comparan en
 * minúsculas. Ante la duda, añadir: el coste de redactar de más es un `?x=***` en
 * una línea de log; el de redactar de menos es un secreto publicado.
 */
const PARAMETROS_SENSIBLES = new Set([
  'st', // token de stream de cámaras (US-185)
  'token', // token de configuración del primer arranque (US-81)
  'setuptoken',
  'access_token',
  'apikey',
  'api_key',
  'key',
  'passphrase',
  'password',
  'pwd',
  'secret',
  'sig',
  'signature',
]);

/** Marcador visible: deja claro que había algo, sin decir qué. */
export const REDACTADO = '***';

/**
 * Devuelve la URL con los valores sensibles sustituidos por `***`, conservando
 * ruta, orden de parámetros y el resto de valores (que sí son útiles para
 * depurar). Si la URL no se puede parsear, se devuelve solo la ruta: es preferible
 * perder contexto a arriesgar que un secreto se cuele por un formato inesperado.
 */
export function redactUrl(url: string): string {
  if (typeof url !== 'string' || url === '') return url;
  const corte = url.indexOf('?');
  if (corte === -1) return url;

  const ruta = url.slice(0, corte);
  const query = url.slice(corte + 1);

  try {
    const params = new URLSearchParams(query);
    let tocado = false;
    for (const nombre of [...params.keys()]) {
      if (!PARAMETROS_SENSIBLES.has(nombre.toLowerCase())) continue;
      params.set(nombre, REDACTADO);
      tocado = true;
    }
    if (!tocado) return url;
    // `URLSearchParams.toString()` re-codifica; `***` no tiene caracteres que
    // escapar, así que el resultado sigue siendo legible.
    return `${ruta}?${params.toString()}`;
  } catch {
    return ruta;
  }
}

/** Forma del objeto de petición que necesita el serializador (evita atarse a Fastify). */
interface PeticionLoggable {
  method?: string;
  url?: string;
  hostname?: string;
  ip?: string;
  socket?: { remotePort?: number };
}

/**
 * Serializador `req` para pino que replica el shape por defecto de Fastify pero
 * con la URL redactada. Se pasa en `logger.serializers` al construir la app.
 */
export function serializarPeticion(req: PeticionLoggable): Record<string, unknown> {
  return {
    method: req.method,
    url: redactUrl(req.url ?? ''),
    hostname: req.hostname,
    remoteAddress: req.ip,
    remotePort: req.socket?.remotePort,
  };
}
