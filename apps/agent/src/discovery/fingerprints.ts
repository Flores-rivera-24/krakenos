import type { DiscoverySuggestion } from '@krakenos/types';

/**
 * Huellas de integración **puras** (US-175): mapean lo visto en la LAN por
 * mDNS/SSDP a sugerencias de integración («Encontramos un bridge Hue —
 * ¿conectar?»). La detección es asistida, no mágica: solo propone lo que casa
 * con una huella conocida; el usuario confirma en el asistente. `prefill`
 * lleva claves de campo del `kindSchema` del backend (sin namespacing, nunca
 * secretos).
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

/** Sugerencia sin los campos que pone el servicio (id/lastSeen). */
export type FingerprintMatch = Omit<DiscoverySuggestion, 'id' | 'lastSeen'>;

/** Primera etiqueta del nombre de instancia mDNS (nombre humano del aparato). */
function instanceLabel(name: string): string | null {
  const first = name.split('.')[0]?.trim();
  return first ? first : null;
}

function matchMdns(record: Extract<DiscoveryProbeRecord, { type: 'mdns' }>): FingerprintMatch | null {
  const service = record.service.toLowerCase();
  const name = record.name.toLowerCase();
  const hostname = instanceLabel(record.name);
  const base = { ip: record.ip, hostname, source: 'mdns' as const };

  if (service.includes('_hue._tcp')) {
    return {
      ...base,
      domain: 'iot',
      kind: 'hue',
      label: 'Bridge Philips Hue',
      prefill: { bridgeUrl: `http://${record.ip}` },
    };
  }
  if (service.includes('_shelly._tcp') || /(^|\b)shelly/i.test(name)) {
    return {
      ...base,
      domain: 'iot',
      kind: 'shelly',
      label: hostname ? `Shelly (${hostname})` : 'Dispositivo Shelly',
      prefill: { devices: record.ip },
    };
  }
  if (service.includes('_mqtt._tcp')) {
    return {
      ...base,
      domain: 'iot',
      kind: 'zigbee',
      label: 'Broker MQTT (¿zigbee2mqtt?)',
      prefill: { brokerUrl: `mqtt://${record.ip}:${record.port ?? 1883}` },
    };
  }
  if (/tapo|(^|\b)p1\d{2}\b/i.test(name)) {
    return {
      ...base,
      domain: 'iot',
      kind: 'kasa',
      label: hostname ? `Tapo (${hostname})` : 'Dispositivo Tapo',
      prefill: { tapoDeviceIps: record.ip },
    };
  }
  if (/kasa|(^|\b)(hs|kl|kp)\d{2,3}\b/i.test(name)) {
    return {
      ...base,
      domain: 'iot',
      kind: 'kasa',
      label: hostname ? `Kasa (${hostname})` : 'Dispositivo Kasa',
      prefill: { kasaDeviceIps: record.ip },
    };
  }
  if (service.includes('_onvif._tcp')) {
    return {
      ...base,
      domain: 'cameras',
      kind: 'rtsp',
      label: hostname ? `Cámara ONVIF (${hostname})` : 'Cámara ONVIF',
      // El alta real de cada cámara (rtspUrl con credenciales) es manual en
      // /cameras; aquí solo se sugiere la integración y se muestra la IP.
      prefill: {},
    };
  }
  return null;
}

function matchSsdp(record: Extract<DiscoveryProbeRecord, { type: 'ssdp' }>): FingerprintMatch | null {
  const headers = record.headers;
  const server = (headers['server'] ?? '').toLowerCase();
  const st = `${headers['st'] ?? ''} ${headers['usn'] ?? ''}`.toLowerCase();
  const base = { ip: record.ip, hostname: null, source: 'ssdp' as const };

  if (headers['hue-bridgeid'] !== undefined || server.includes('ipbridge')) {
    return {
      ...base,
      domain: 'iot',
      kind: 'hue',
      label: 'Bridge Philips Hue',
      prefill: { bridgeUrl: `http://${record.ip}` },
    };
  }
  if (server.includes('shelly') || st.includes('shelly')) {
    return {
      ...base,
      domain: 'iot',
      kind: 'shelly',
      label: 'Dispositivo Shelly',
      prefill: { devices: record.ip },
    };
  }
  if (st.includes('onvif') || server.includes('onvif')) {
    return {
      ...base,
      domain: 'cameras',
      kind: 'rtsp',
      label: 'Cámara ONVIF',
      prefill: {},
    };
  }
  return null;
}

/**
 * Casa los registros del sondeo contra las huellas y deduplica por
 * `kind:ip` (un mismo aparato suele responder por mDNS y SSDP a la vez).
 */
export function matchFingerprints(records: DiscoveryProbeRecord[]): FingerprintMatch[] {
  const out = new Map<string, FingerprintMatch>();
  for (const record of records) {
    const match = record.type === 'mdns' ? matchMdns(record) : matchSsdp(record);
    if (!match) continue;
    const key = `${match.kind}:${match.ip}`;
    // mDNS aporta hostname; si ya había una entrada SSDP sin él, se mejora.
    const existing = out.get(key);
    if (!existing || (existing.hostname === null && match.hostname !== null)) {
      out.set(key, match);
    }
  }
  return [...out.values()];
}
