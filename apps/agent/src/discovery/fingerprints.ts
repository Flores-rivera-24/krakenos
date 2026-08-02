import type { DiscoverySuggestion } from '@krakenos/types';

/**
 * Huellas de integración **puras** (US-175): mapean lo visto en la LAN por
 * mDNS/SSDP a sugerencias de integración («Encontramos un bridge Hue —
 * ¿conectar?»). La detección es asistida, no mágica: solo propone lo que casa
 * con una huella conocida; el usuario confirma en el asistente. `prefill`
 * lleva claves de campo del `kindSchema` del backend (sin namespacing, nunca
 * secretos).
 *
 * ⚠️ **El `prefill` tiene que ser válido para el backend, no solo parecerlo**
 * (US-249): el de Shelly precargaba la IP a secas en un campo que el servidor
 * parsea como **lista JSON**, así que quien seguía la sugerencia acababa con cero
 * aparatos y sin ningún error. Al añadir una huella, comprobar contra
 * `factory-config.ts` cómo se lee ese campo.
 */

/** Registro crudo recogido por el sondeo (transporte aparte, inyectable). */
export type DiscoveryProbeRecord =
  | {
      type: 'mdns';
      /** Servicio, p. ej. `_hue._tcp.local`. */
      service: string;
      /** Nombre de la instancia, p. ej. `Shelly Plus 1._shelly._tcp.local`. */
      name: string;
      ip: string;
      port: number | null;
      txt: Record<string, string>;
    }
  | { type: 'ssdp'; ip: string; headers: Record<string, string> };

/** Sugerencia sin los campos que pone el servicio (id/lastSeen/adoptable). */
export type FingerprintMatch = Omit<DiscoverySuggestion, 'id' | 'lastSeen' | 'adoptable'>;

/** Primera etiqueta del nombre de instancia mDNS (nombre humano del aparato). */
function instanceLabel(name: string): string | null {
  const first = name.split('.')[0]?.trim();
  return first ? first : null;
}

/**
 * ¿IPv4 privada (RFC 1918)? El registro A de un datagrama mDNS lo controla el
 * emisor: sin este filtro, un aparato hostil podría anunciar una IP pública y
 * colar «detectado en tu red» una sugerencia que apunta fuera de la LAN.
 */
export function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false;
  }
  const [a, b] = parts as [number, number, number, number];
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/**
 * Entrada de la lista `SHELLY_DEVICES` para un aparato descubierto. La generación
 * la dice el propio anuncio (`gen` en el TXT de los Gen2+); sin ella se asume la 1,
 * que es el valor que ya usa el parser del backend. El resto de campos se dejan en
 * su defecto: **no se inventa** el número de canales ni el tipo.
 */
function shellyDevice(record: Extract<DiscoveryProbeRecord, { type: 'mdns' }>): {
  ip: string;
  name?: string;
  gen: 1 | 2;
} {
  const nombre = instanceLabel(record.name);
  const gen = record.txt['gen'] === '2' || record.txt['gen'] === '3' ? 2 : 1;
  return nombre ? { ip: record.ip, name: nombre, gen } : { ip: record.ip, gen };
}

function matchMdns(record: Extract<DiscoveryProbeRecord, { type: 'mdns' }>): FingerprintMatch[] {
  const service = record.service.toLowerCase();
  const name = record.name.toLowerCase();
  const hostname = instanceLabel(record.name);
  const base = { ip: record.ip, hostname, source: 'mdns' as const };

  if (service.includes('_hue._tcp')) {
    return [
      {
        ...base,
        domain: 'iot',
        kind: 'hue',
        label: 'Bridge Philips Hue',
        prefill: { bridgeUrl: `http://${record.ip}` },
      },
    ];
  }
  if (service.includes('_shelly._tcp') || /(^|\b)shelly/i.test(name)) {
    return [
      {
        ...base,
        domain: 'iot',
        kind: 'shelly',
        label: hostname ? `Shelly (${hostname})` : 'Dispositivo Shelly',
        prefill: { devices: JSON.stringify([shellyDevice(record)]) },
      },
    ];
  }
  if (service.includes('_esphomelib._tcp')) {
    // Un ESPHome en la red significa que la ingesta genérica (US-248) es la vía.
    // El broker no lo dice el aparato, así que no se precarga — y por eso esta
    // sugerencia **no es de un toque**: abre el asistente, que explica qué falta.
    return [
      {
        ...base,
        domain: 'iot',
        kind: 'mqtt',
        label: hostname ? `Dispositivo ESPHome (${hostname})` : 'Dispositivo ESPHome',
        prefill: {},
      },
    ];
  }
  if (service.includes('_mqtt._tcp')) {
    // Un broker no dice **para qué** se usa, así que se ofrecen las dos vías que
    // lo aprovechan en vez de adivinar una: la ingesta genérica (US-248, sirve con
    // cualquier aparato que se anuncie) y zigbee2mqtt (exige tenerlo corriendo).
    const brokerUrl = `mqtt://${record.ip}:${record.port ?? 1883}`;
    return [
      {
        ...base,
        domain: 'iot',
        kind: 'mqtt',
        label: 'Broker MQTT · ingesta de aparatos (ESPHome, Tasmota…)',
        prefill: { brokerUrl },
      },
      {
        ...base,
        domain: 'iot',
        kind: 'zigbee',
        label: 'Broker MQTT · zigbee2mqtt',
        prefill: { brokerUrl },
      },
    ];
  }
  if (/tapo|(^|\b)p1\d{2}\b/i.test(name)) {
    return [
      {
        ...base,
        domain: 'iot',
        kind: 'kasa',
        label: hostname ? `Tapo (${hostname})` : 'Dispositivo Tapo',
        prefill: { tapoDeviceIps: record.ip },
      },
    ];
  }
  if (/kasa|(^|\b)(hs|kl|kp)\d{2,3}\b/i.test(name)) {
    return [
      {
        ...base,
        domain: 'iot',
        kind: 'kasa',
        label: hostname ? `Kasa (${hostname})` : 'Dispositivo Kasa',
        prefill: { kasaDeviceIps: record.ip },
      },
    ];
  }
  if (service.includes('_onvif._tcp')) {
    return [
      {
        ...base,
        domain: 'cameras',
        kind: 'rtsp',
        label: hostname ? `Cámara ONVIF (${hostname})` : 'Cámara ONVIF',
        // El alta real de cada cámara (rtspUrl con credenciales) es manual en
        // /cameras; aquí solo se sugiere la integración y se muestra la IP.
        prefill: {},
      },
    ];
  }
  return [];
}

function matchSsdp(record: Extract<DiscoveryProbeRecord, { type: 'ssdp' }>): FingerprintMatch[] {
  const headers = record.headers;
  const server = (headers['server'] ?? '').toLowerCase();
  const st = `${headers['st'] ?? ''} ${headers['usn'] ?? ''}`.toLowerCase();
  const base = { ip: record.ip, hostname: null, source: 'ssdp' as const };

  if (headers['hue-bridgeid'] !== undefined || server.includes('ipbridge')) {
    return [
      {
        ...base,
        domain: 'iot',
        kind: 'hue',
        label: 'Bridge Philips Hue',
        prefill: { bridgeUrl: `http://${record.ip}` },
      },
    ];
  }
  if (server.includes('shelly') || st.includes('shelly')) {
    return [
      {
        ...base,
        domain: 'iot',
        kind: 'shelly',
        label: 'Dispositivo Shelly',
        // SSDP no trae la generación; la lista JSON se construye igual que en mDNS
        // para que el backend la sepa leer (US-249).
        prefill: { devices: JSON.stringify([{ ip: record.ip, gen: 1 }]) },
      },
    ];
  }
  if (st.includes('onvif') || server.includes('onvif')) {
    return [
      {
        ...base,
        domain: 'cameras',
        kind: 'rtsp',
        label: 'Cámara ONVIF',
        prefill: {},
      },
    ];
  }
  return [];
}

/**
 * Casa los registros del sondeo contra las huellas y deduplica por
 * `kind:ip` (un mismo aparato suele responder por mDNS y SSDP a la vez).
 */
export function matchFingerprints(records: DiscoveryProbeRecord[]): FingerprintMatch[] {
  const out = new Map<string, FingerprintMatch>();
  for (const record of records) {
    // Solo IPs de la LAN: la IP anunciada la controla el emisor del datagrama.
    if (!isPrivateIpv4(record.ip)) continue;
    for (const match of record.type === 'mdns' ? matchMdns(record) : matchSsdp(record)) {
      const key = `${match.kind}:${match.ip}`;
      // mDNS aporta hostname; si ya había una entrada SSDP sin él, se mejora.
      const existing = out.get(key);
      if (!existing || (existing.hostname === null && match.hostname !== null)) {
        out.set(key, match);
      }
    }
  }
  return [...out.values()];
}
