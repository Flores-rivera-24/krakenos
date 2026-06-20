import type { DiscoveredDevice } from '@krakenos/types';
import { normalizeCiscoMac } from './cisco-ios.parsers.js';

/**
 * Parsers **puros** de respuestas NETCONF (XML) de IOS-XE. Sin dependencias
 * externas: se extraen los elementos conocidos de los modelos YANG con un
 * recorrido por etiquetas (las respuestas son XML simple y predecible). Reciben
 * el texto ya capturado, así que se testean con fixtures sin un router real.
 */

/** Devuelve el texto del primer hijo `<tag>` dentro de `xml`, o `null`. */
function tagText(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`));
  return m ? m[1]!.trim() : null;
}

/** Devuelve todos los bloques `<tag>…</tag>` (con su contenido). */
function blocks(xml: string, tag: string): string[] {
  return [...xml.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) => m[1]!);
}

export interface NetconfArpEntry {
  ip: string;
  mac: string;
  interface: string;
}

/**
 * Parsea la respuesta de `arp-data` (`Cisco-IOS-XE-arp-oper`). Cada entrada vive
 * en un `<arp-oper>` con `<address>`, `<hardware>` (MAC Cisco) e `<interface>`.
 */
export function parseNetconfArp(xml: string): NetconfArpEntry[] {
  const out: NetconfArpEntry[] = [];
  for (const block of blocks(xml, 'arp-oper')) {
    const ip = tagText(block, 'address');
    const hw = tagText(block, 'hardware');
    const iface = tagText(block, 'interface') ?? '';
    if (!ip || !hw) continue;
    try {
      out.push({ ip, mac: normalizeCiscoMac(hw), interface: iface });
    } catch {
      // MAC con formato inesperado: se descarta la entrada.
    }
  }
  return out;
}

export interface NetconfIfaceCounters {
  rxBytes: number;
  txBytes: number;
}

/**
 * Extrae los contadores `in-octets`/`out-octets` de la interfaz `name` en la
 * respuesta de `interfaces` (`Cisco-IOS-XE-interfaces-oper`). `null` si la
 * interfaz no aparece.
 */
export function parseNetconfInterface(xml: string, name: string): NetconfIfaceCounters | null {
  for (const block of blocks(xml, 'interface')) {
    if (tagText(block, 'name') !== name) continue;
    return {
      rxBytes: Number(tagText(block, 'in-octets') ?? 0),
      txBytes: Number(tagText(block, 'out-octets') ?? 0),
    };
  }
  return null;
}

/** Convierte entradas ARP NETCONF a dispositivos descubiertos del contrato. */
export function netconfArpToDevices(entries: NetconfArpEntry[]): DiscoveredDevice[] {
  const seen = new Set<string>();
  const out: DiscoveredDevice[] = [];
  for (const e of entries) {
    if (seen.has(e.mac)) continue;
    seen.add(e.mac);
    out.push({ mac: e.mac, ip: e.ip, source: 'arp' });
  }
  return out;
}
