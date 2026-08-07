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
  // US-248: es la definición misma de «protocolo abierto» — el aparato se anuncia
  // contra un broker del usuario y no hay app ni nube de fabricante en el camino.
  mqtt: 'core',
  zigbee: 'core',
  matter: 'core',
  hue: 'core',
  shelly: 'core',
  // ⚠️ Kasa es local (XOR), pero **Tapo comparte backend** y sí pide la cuenta
  // TP-Link. `adr-control-total.md` lo lista en primera clase y se respeta: el
  // compromiso de mantenimiento se sostiene. Lo que Tapo necesita de la app se
  // declara aparte, en `MANUFACTURER_APP` (US-258), porque son dos cosas distintas.
  kasa: 'core',
  // Necesitan la app del fabricante al menos una vez.
  tuya: 'community', // la `localKey` la emite el emparejamiento contra su nube
  govee: 'community', // «LAN Control» se activa aparato a aparato desde su app
  meross: 'community', // empareja por su app; el control local exige redirigir DNS
};

/**
 * Para qué hace falta la app del fabricante (US-258). Unión **cerrada**: cada valor
 * es una cosa distinta que el usuario tiene que hacer, y la UI las explica una a una.
 *
 * - `pairing`: el emparejamiento se hace **contra su nube**, y de ahí sale el secreto
 *   que necesita el control local (la `localKey` de Tuya, que además **cambia** en
 *   cada re-emparejamiento).
 * - `account`: hace falta la **cuenta del fabricante** para hablar con el aparato.
 * - `enable-local`: el control local viene **apagado** y se enciende desde su app,
 *   **aparato a aparato** (el «LAN Control» de Govee).
 */
export const APP_DEPENDENCY_REASONS = ['pairing', 'account', 'enable-local'] as const;
export type AppDependencyReason = (typeof APP_DEPENDENCY_REASONS)[number];

/**
 * Dependencia de la app del fabricante de un backend IoT.
 *
 * `scope` existe por un caso real y no por simetría: **Kasa y Tapo comparten
 * backend**. Un enchufe Kasa clásico se controla en local sin cuenta, y un Tapo
 * exige las credenciales TP-Link. Sin este campo solo caben dos mentiras —marcar
 * todo el backend (falso para Kasa) o no marcar nada (falso para Tapo, y es lo que
 * había)—, así que se dice «solo algunos» y se nombra cuáles.
 */
export interface ManufacturerAppDependency {
  reason: AppDependencyReason;
  /** `all` = todo lo que cubre el backend; `some` = solo parte, descrita en `devices`. */
  scope: 'all' | 'some';
  /** Con `scope: 'some'`, qué parte del parque la necesita (p. ej. `'Tapo'`). */
  devices?: string;
}

/**
 * Qué backends IoT necesitan la app del fabricante, y para qué (US-258).
 *
 * **No es lo mismo que `community`**, y confundirlos es lo que dejaba a Kasa/Tapo
 * sin marca: `community` es un compromiso de **mantenimiento** («puede romperse y
 * no prometo perseguirlo») y esto es un **requisito práctico** que se paga antes de
 * comprar («vas a tener que abrir su app»). Casi siempre van juntos, pero Kasa es
 * `core` —se mantiene— y aun así Tapo pide la cuenta.
 *
 * Exhaustivo sobre `IotKind`: un backend nuevo **no compila** hasta declarar si
 * necesita la app o no, en vez de heredar «no» por omisión, que es el valor que
 * miente a favor del producto.
 */
export const MANUFACTURER_APP: Record<IotKind, ManufacturerAppDependency | null> = {
  mock: null,
  mqtt: null,
  zigbee: null,
  matter: null,
  hue: null,
  shelly: null,
  // El único `core` con dependencia: el backend cubre las dos gamas de TP-Link y
  // solo una la necesita. Ver `scope` arriba.
  kasa: { reason: 'account', scope: 'some', devices: 'Tapo' },
  tuya: { reason: 'pairing', scope: 'all' },
  govee: { reason: 'enable-local', scope: 'all' },
  meross: { reason: 'pairing', scope: 'all' },
};

/**
 * Fecha (ISO `YYYY-MM-DD`) de la última verificación **con el aparato físico**,
 * por id de catálogo (US-86).
 *
 * ⚠️ **Vacío a propósito**: hoy son **cero** verificaciones, y esa es justo la cifra
 * que el proyecto no quiere disimular. Un mapa vacío hace que la ficha diga «sin
 * verificar» sola; rellenar una entrada aquí es afirmar que alguien enchufó el
 * cacharro y lo probó, así que se toca **después** de la tanda de hardware, nunca
 * para que la tabla se vea mejor.
 */
export const HARDWARE_VERIFIED_AT: Record<string, string> = {};

export interface CompatibilityEntry {
  /** Id estable `<categoría>:<kind>` (p. ej. `driver:openwrt`). */
  id: string;
  category: CompatCategory;
  /** Nombre visible (marca/modelo/protocolo), del catálogo de integraciones. */
  label: string;
  capabilities: CompatCapability[];
  requirements: CompatRequirement[];
  /**
   * Fecha de la última verificación con hardware real (US-86), o `null` si nunca se
   * ha probado con el aparato físico.
   *
   * Es una **fecha y no un booleano** (US-258) porque «verificado» sin cuándo
   * envejece mal: una comprobación de hace dos años sobre un firmware que ya no
   * existe se lee igual que una de ayer. Y al ser un solo campo no puede darse el
   * estado imposible de `verified: true` sin fecha.
   */
  verifiedAt: string | null;
  /** Compromiso de mantenimiento: ver {@link SupportLevel}. */
  support: SupportLevel;
  /**
   * Qué necesita de la app del fabricante, o `null` si nada (US-258).
   * Ver {@link MANUFACTURER_APP} para por qué no basta con `support`.
   */
  appDependency: ManufacturerAppDependency | null;
}
