/**
 * Catálogo de compatibilidad de hardware (US-208). Se **deriva del código**
 * (el catálogo de integraciones + los drivers) como fuente única: no es una lista
 * mantenida a mano. Cada entrada dice qué sabe hacer una integración y qué
 * necesita, y si está **verificada con hardware real** (checklist US-86) o solo
 * soportada por código.
 */

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
}
