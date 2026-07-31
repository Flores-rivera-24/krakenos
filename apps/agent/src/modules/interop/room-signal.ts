import type { HardwareDriver } from '@krakenos/types';
import type { SnapshotRoomSignal } from './ha-discovery.js';

/**
 * Peor señal WiFi por habitación (US-236). Es el **sustituto honesto** del sensor
 * de «cobertura por habitación» que pedía la historia original y que **no es
 * computable**: `Room` no guarda geometría, no hay vínculo `Room↔FloorPlan`, y el
 * heatmap es un **modelo estático** que no se movería si un AP se cae —publicarlo
 * como `signal_strength` habría sugerido una medida viva que no existe.
 *
 * Esto, en cambio, es **medido, actual y no necesita plano**: cruza `Device.roomId`
 * (ya existe e indexado) con el `signalDbm` que el driver reporta en vivo.
 *
 * ⚠️ **Matiz que la UI debe decir**: el RSSI lo ve el **punto de acceso**, no el
 * móvil. Es «señal de los aparatos de esta habitación», no «cobertura».
 */

/** Dispositivo asignado a una habitación (solo lo necesario para el cruce). */
export interface RoomDeviceRow {
  mac: string;
  roomId: string | null;
  online: boolean;
}

export interface RoomRow {
  id: string;
  name: string;
}

/**
 * Recorre las redes del driver **una sola vez** y devuelve, por MAC, la señal más
 * fuerte con la que algún AP lo oye. Un barrido por AP en vez de uno por
 * dispositivo: con 40 aparatos y 3 redes eran 120 llamadas al router.
 *
 * No lanza: un driver sin WiFi (pfSense) o un fallo puntual devuelven un
 * mapa vacío, y las habitaciones quedan «sin dato» en vez de tumbar la publicación.
 */
export async function collectSignalByMac(driver: HardwareDriver): Promise<Map<string, number>> {
  const byMac = new Map<string, number>();
  try {
    const networks = await driver.listWifiNetworks();
    for (const net of networks) {
      const clients = await driver.listNetworkClients(net.id).catch(() => null);
      if (!clients) continue;
      for (const client of clients) {
        const mac = client.mac.toLowerCase();
        const prev = byMac.get(mac);
        // Nos quedamos con el AP que MEJOR lo oye: es su enlace real.
        if (prev === undefined || client.signalDbm > prev) byMac.set(mac, client.signalDbm);
      }
    }
  } catch {
    return byMac;
  }
  return byMac;
}

/**
 * Recolector con **TTL y single-flight** (patrón `iot/device-cache.ts`, US-229).
 *
 * ⚠️ Sin esto, la publicación MQTT interrogaría al router **en cada tick**: el
 * intervalo es configurable hasta 5 s, así que un usuario con la publicación
 * rápida volvería a machacar el router con `listNetworkClients` — exactamente el
 * sondeo excesivo que US-229 eliminó. La señal WiFi no cambia en 5 s; un TTL de
 * 60 s da un dato igual de honesto por una fracción del tráfico.
 */
export interface SignalCollector {
  get(): Promise<Map<string, number>>;
}

export function createSignalCollector(
  driver: HardwareDriver,
  opts: { ttlMs?: number; now?: () => number } = {},
): SignalCollector {
  const ttlMs = opts.ttlMs ?? 60_000;
  const now = opts.now ?? (() => Date.now());
  let cached: Map<string, number> | null = null;
  let cachedAt = 0;
  let inFlight: Promise<Map<string, number>> | null = null;

  return {
    async get() {
      if (cached && now() - cachedAt < ttlMs) return cached;
      // Single-flight: dos ticks solapados no disparan dos barridos al router.
      inFlight ??= collectSignalByMac(driver)
        .then((res) => {
          cached = res;
          cachedAt = now();
          return res;
        })
        .finally(() => {
          inFlight = null;
        });
      return inFlight;
    },
  };
}

/**
 * Cruce **puro**: por habitación, la **peor** (mínima) señal entre sus aparatos
 * WiFi en línea. Una habitación sin aparatos WiFi conectados devuelve `null`, que
 * aguas abajo se publica como *no disponible* — nunca como un `0` ni un `-100`
 * inventado, que en HA serían indistinguibles de una medida real pésima.
 */
export function worstSignalByRoom(
  rooms: RoomRow[],
  devices: RoomDeviceRow[],
  signalByMac: Map<string, number>,
): SnapshotRoomSignal[] {
  const worst = new Map<string, number>();
  for (const dev of devices) {
    if (!dev.roomId || !dev.online) continue;
    const dbm = signalByMac.get(dev.mac.toLowerCase());
    if (dbm === undefined) continue; // no está en WiFi (cable, o no lo ve ningún AP)
    const prev = worst.get(dev.roomId);
    if (prev === undefined || dbm < prev) worst.set(dev.roomId, dbm);
  }
  return rooms.map((r) => ({ id: r.id, name: r.name, worstDbm: worst.get(r.id) ?? null }));
}
