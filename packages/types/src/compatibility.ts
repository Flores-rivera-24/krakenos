/**
 * Catálogo de compatibilidad de hardware (US-208). Se **deriva del código**
 * (el catálogo de integraciones + los drivers) como fuente única: no es una lista
 * mantenida a mano. Cada entrada dice qué sabe hacer una integración y qué
 * necesita, y si está **verificada con hardware real** (checklist US-86) o solo
 * soportada por código.
 */

import type { IotKind } from './iot.js';

/** Capacidad concreta que ofrece una integración. */
export const COMPAT_CAPABILITIES = [
  'inventory', // ver dispositivos de la red
  'block', // bloquear el acceso de un dispositivo
  'traffic', // medir tráfico del hogar (WAN)
  // Desglose POR APARATO (US-263). Es una capacidad aparte de `traffic`: hoy
  // ningún driver real la tiene, y de ella dependen la tabla «Por dispositivo» y
  // todo el bienestar digital. Arreglo de fondo: US-251.
  'traffic-per-device',
  'wifi', // gestionar la WiFi (SSID/contraseña)
  'control', // encender/apagar/atenuar (IoT)
  'vpn', // acceso remoto (VPN)
  'firewall', // reglas de cortafuegos
  'vlan', // VLANs
  'qos', // prioridad de tráfico (QoS)
  'dns-block', // bloqueo de dominios (DNS)
  'camera-stream', // vídeo en vivo
  'camera-snapshot', // captura de imagen
] as const;
export type CompatCapability = (typeof COMPAT_CAPABILITIES)[number];

/** Requisito para poner en marcha una integración. */
export const COMPAT_REQUIREMENTS = [
  'address', // dirección del equipo (host/URL) en la LAN
  'credentials', // usuario/contraseña o clave de API
  'extra-dependency', // paquete/servicio opcional a instalar en el servidor
  // US-251: distinto de `extra-dependency` a propósito — esto se instala en el
  // ROUTER, no en el servidor de KrakenOS, y quien lo lee necesita saber dónde
  // tiene que teclear el comando.
  'router-package', // paquete a instalar en el router (p. ej. nlbwmon en OpenWrt)
] as const;
export type CompatRequirement = (typeof COMPAT_REQUIREMENTS)[number];

/** Categoría (agrupa por tipo de equipo). Coincide con el dominio de integración. */
export const COMPAT_CATEGORIES = [
  'driver', // routers / puntos de acceso
  'iot', // dispositivos inteligentes
  'cameras',
  'vpn',
  'firewall',
  'vlan',
  'qos',
  'dns',
] as const;
export type CompatCategory = (typeof COMPAT_CATEGORIES)[number];

/**
 * Nivel de soporte de una integración (US-238, criterio de `docs/adr-control-total.md`).
 *
 * - `core`: habla un **protocolo abierto** o empareja **en local** (Zigbee, Matter,
 *   Hue, Shelly, Kasa, y todo lo que no sea IoT: SSH, REST local, SNMP, RTSP…).
 *   Es lo que el proyecto se compromete a mantener y a arreglar.
 * - `community`: **necesita la app o la nube del fabricante** al menos una vez —para
 *   emparejar, para sacar una clave o para habilitar el control local—. Se conserva
 *   el código, pero **sin garantía**: puede romperse cuando el fabricante cambie algo,
 *   y un mantenedor único no puede prometer perseguir eso.
 *
 * No es lo mismo que `verified` (US-86, «¿se ha probado con el aparato físico?») ni
 * que el `tier` de las guías, que mide **dificultad** para quien lo instala.
 */
export const SUPPORT_LEVELS = ['core', 'community'] as const;
export type SupportLevel = (typeof SUPPORT_LEVELS)[number];

/**
 * Nivel de soporte por backend IoT. **Fuente única** (US-238): lo consumen el
 * catálogo de compatibilidad del agente y el asistente de la web, que si no se
 * desincronizarían — y el fallo sería mostrar «sin garantía» en un sitio y no en
 * el otro, que es peor que no decirlo.
 *
 * Exhaustivo sobre `IotKind` a propósito: **un backend nuevo no compila hasta
 * clasificarlo**, en vez de heredar «soportado» por omisión.
 */
export const IOT_SUPPORT_LEVEL: Record<IotKind, SupportLevel> = {
  // Protocolo abierto o emparejamiento contra el servidor propio.
  mock: 'core',
  zigbee: 'core',
  matter: 'core',
  hue: 'core',
  shelly: 'core',
  // ⚠️ Kasa es local (XOR), pero **Tapo comparte backend** y sí pide la cuenta
  // TP-Link. `adr-control-total.md` lo lista en primera clase y se respeta; que la
  // ficha lo diga aparato a aparato es US-258, y no guardar la contraseña entera
  // es US-259.
  kasa: 'core',
  // Necesitan la app del fabricante al menos una vez.
  tuya: 'community', // la `localKey` la emite el emparejamiento contra su nube
  govee: 'community', // «LAN Control» se activa aparato a aparato desde su app
  meross: 'community', // empareja por su app; el control local exige redirigir DNS
};

export interface CompatibilityEntry {
  /** Id estable `<categoría>:<kind>` (p. ej. `driver:openwrt`). */
  id: string;
  category: CompatCategory;
  /** Nombre visible (marca/modelo/protocolo), del catálogo de integraciones. */
  label: string;
  capabilities: CompatCapability[];
  requirements: CompatRequirement[];
  /**
   * `true` si está verificada con hardware real (US-86); `false` = soportada por
   * código pero aún sin verificar en un despliegue con el equipo físico.
   */
  verified: boolean;
  /** Compromiso de mantenimiento: ver {@link SupportLevel}. */
  support: SupportLevel;
}
