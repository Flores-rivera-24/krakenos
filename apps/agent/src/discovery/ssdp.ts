/**
 * Codificador/parser **puro** de SSDP (UPnP simple service discovery) para el
 * auto-descubrimiento (US-175). Solo M-SEARCH multicast + parseo de las
 * cabeceras de la respuesta; una respuesta malformada devuelve `null`.
 */

export const SSDP_GROUP = '239.255.255.250';
export const SSDP_PORT = 1900;

/** Mensaje M-SEARCH estándar (`ssdp:all`: las huellas filtran después). */
export function buildMSearch(waitSec = 2): Buffer {
  return Buffer.from(
    'M-SEARCH * HTTP/1.1\r\n' +
      `HOST: ${SSDP_GROUP}:${SSDP_PORT}\r\n` +
      'MAN: "ssdp:discover"\r\n' +
      `MX: ${waitSec}\r\n` +
      'ST: ssdp:all\r\n' +
      '\r\n',
    'ascii',
  );
}

/**
 * Cabeceras (en minúsculas) de una respuesta SSDP `HTTP/1.1 200 OK`, o `null`
 * si el datagrama no es una respuesta SSDP.
 */
export function parseSsdpResponse(buf: Buffer): Record<string, string> | null {
  const text = buf.toString('utf8');
  const lines = text.split('\r\n');
  const status = lines[0] ?? '';
  if (!/^HTTP\/1\.\d\s+200/i.test(status)) return null;
  const headers: Record<string, string> = {};
  for (const line of lines.slice(1)) {
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
  }
  return headers;
}
