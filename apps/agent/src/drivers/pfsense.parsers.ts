import type { DiscoveredDevice } from '@krakenos/types';

/**
 * Parsers/builders **puros** para la REST API v2 de pfSense. Reciben el `data`
 * ya desempaquetado del sobre y devuelven tipos del contrato, de modo que se
 * testean con fixtures sin un pfSense real.
 */

const MAC_RE = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/;

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function numLike(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

/**
 * Mapea la tabla ARP (`GET /api/v2/diagnostics/arp_table`) a dispositivos.
 * Cada entrada trae `ip` y `mac` (y a veces `hostname`/`interface`).
 */
export function parsePfSenseArp(data: unknown): DiscoveredDevice[] {
  const out: DiscoveredDevice[] = [];
  const seen = new Set<string>();
  for (const entry of asArray(data)) {
    const mac = str(entry.mac)?.toLowerCase();
    const ip = str(entry.ip);
    if (!mac || !ip || !MAC_RE.test(mac) || seen.has(mac)) continue;
    seen.add(mac);
    out.push({ mac, ip, source: 'arp' });
  }
  return out;
}

/**
 * Mapea las concesiones DHCP (`GET /api/v2/services/dhcp_server/leases`) a
 * dispositivos con hostname (fuente de nombres en pfSense). Source `mdns` para
 * encajar en el pipeline de enriquecimiento del inventario.
 */
export function parsePfSenseLeases(data: unknown): DiscoveredDevice[] {
  const out: DiscoveredDevice[] = [];
  const seen = new Set<string>();
  for (const entry of asArray(data)) {
    const mac = str(entry.mac)?.toLowerCase();
    const ip = str(entry.ip);
    const hostname = str(entry.hostname);
    if (!mac || !ip || !hostname || !MAC_RE.test(mac) || seen.has(mac)) continue;
    seen.add(mac);
    out.push({ mac, ip, hostname, source: 'mdns' });
  }
  return out;
}

/** Contadores rx/tx (bytes acumulados) de una interfaz. */
export interface IfaceCounters {
  rxBytes: number;
  txBytes: number;
}

/**
 * Extrae los contadores de la interfaz WAN de `GET /api/v2/status/interface`.
 * Empareja `wan` contra `name`/`descr`/`hwif`/`if` y lee `inbytes`/`outbytes`
 * (con alias `bytesin`/`bytesout`).
 */
export function parsePfSenseInterfaceCounters(data: unknown, wan: string): IfaceCounters | null {
  const want = wan.toLowerCase();
  for (const entry of asArray(data)) {
    const names = [entry.name, entry.descr, entry.hwif, entry.if]
      .map((v) => str(v)?.toLowerCase())
      .filter(Boolean);
    if (!names.includes(want)) continue;
    const rx = entry.inbytes ?? entry.bytesin;
    const tx = entry.outbytes ?? entry.bytesout;
    return { rxBytes: numLike(rx), txBytes: numLike(tx) };
  }
  return null;
}

/** Una regla de firewall mínima (id + descripción) para localizarla. */
export interface FirewallRuleRef {
  id: number;
  descr: string;
}

/** Descripción con la que KrakenOS etiqueta sus reglas de bloqueo por MAC. */
export function blockRuleDescr(mac: string): string {
  return `krakenos-block:${mac.toLowerCase()}`;
}

/** Mapea `GET /api/v2/firewall/rules` a referencias {id, descr}. */
export function parseFirewallRules(data: unknown): FirewallRuleRef[] {
  const out: FirewallRuleRef[] = [];
  for (const entry of asArray(data)) {
    const descr = str(entry.descr);
    const id = entry.id;
    if (descr !== null && typeof id === 'number') out.push({ id, descr });
  }
  return out;
}

/** Busca el `ip` asociado a una `mac` dentro de la tabla ARP ya parseada. */
export function ipForMac(arp: DiscoveredDevice[], mac: string): string | null {
  const m = mac.toLowerCase();
  return arp.find((d) => d.mac === m)?.ip ?? null;
}

/**
 * Construye el payload de `POST /api/v2/firewall/rule` para bloquear una IP en
 * una interfaz, etiquetado con la MAC para poder localizarlo y borrarlo después.
 */
export function buildBlockRulePayload(ip: string, mac: string, lanInterface: string): unknown {
  return {
    type: 'block',
    interface: [lanInterface],
    ipprotocol: 'inet',
    protocol: 'any',
    source: ip,
    destination: 'any',
    descr: blockRuleDescr(mac),
  };
}
