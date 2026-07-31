import type { DriverKind, PerDeviceTrafficCapability, PerDeviceTrafficStatus } from '@krakenos/types';

/**
 * Capacidades **declaradas** de cada driver (US-263, ampliado en US-251).
 *
 * ## Por qué existe esto
 *
 * `getTrafficSample()` devuelve `{ wan, devices }`. El array `devices` es la
 * **única** fuente de `DeviceTrafficSample`, y de ahí cuelgan el desglose «Por
 * dispositivo» de Tráfico y **todo** el bienestar digital (US-184).
 *
 * Hasta US-251, los **ocho drivers reales devolvían `devices: []`**: en cualquier
 * casa real esas dos features estaban vacías, y la UI lo explicaba diciendo
 * «asigna un dueño a los dispositivos» — mandando al usuario a configurar algo que
 * no arreglaba nada.
 *
 * ## Por qué DECLARADO y no deducido
 *
 * Un `devices: []` en tiempo de ejecución es ambiguo: puede significar «este driver
 * no sabe» o «ahora mismo no hay tráfico». Justo el día que el usuario estrena la
 * instalación —cuando más confundido está— las dos son indistinguibles. La
 * declaración es inequívoca desde el primer segundo.
 *
 * ## Declarado ≠ disponible (US-251)
 *
 * Este mapa es el **techo**: lo que el código del driver sabe hacer. Para OpenWrt
 * el dato existe **si el router tiene `nlbwmon`**, y eso no se sabe sin
 * preguntárselo. Por eso los drivers que dependen del aparato implementan
 * `perDeviceTrafficCapability()` y el estado final sale de ahí; el mapa solo dice
 * si merece la pena preguntar.
 *
 * El mapa es **exhaustivo sobre `DriverKind`**: añadir un driver no compila hasta
 * declarar si reporta el desglose, y `drivers-capabilities.test.ts` comprueba que
 * lo declarado coincide con lo que el código hace de verdad.
 */
export const PER_DEVICE_TRAFFIC_BY_KIND: Record<DriverKind, boolean> = {
  // Simulado, pero rellena el desglose de verdad (`mock.driver.ts`).
  mock: true,
  // Contabilidad real por MAC vía `nlbwmon` sobre el SSH que ya existe (US-251).
  // Requiere el paquete en el router → estado real en `perDeviceTrafficCapability()`.
  openwrt: true,
  // Los siete restantes siguen devolviendo `devices: []` de forma literal. Cada uno
  // necesita su propia vía y ninguna es gratis: `/ip accounting` o simple-queues en
  // MikroTik, `stat/sta` en UniFi (que además mide LAN+WAN, no solo internet),
  // pfSense necesita pfflowd/ntopng. Se harán con su historia y su verificación.
  pfsense: false,
  unifi: false,
  mikrotik: false,
  omada: false,
  asus: false,
};

/**
 * ¿Puede este driver, **en principio**, reportar el desglose por dispositivo? Es
 * el techo declarado, no la disponibilidad real: para eso está
 * `resolvePerDeviceTraffic`.
 */
export function reportsPerDeviceTraffic(kind: DriverKind): boolean {
  return PER_DEVICE_TRAFFIC_BY_KIND[kind] ?? false;
}

/** Capacidad estática de un kind, para los drivers que no sondean nada. */
export function declaredCapability(kind: DriverKind): PerDeviceTrafficCapability {
  const status: PerDeviceTrafficStatus = reportsPerDeviceTraffic(kind)
    ? 'supported'
    : 'unsupported';
  return { status };
}

/**
 * Estado **real** de la capacidad: pregunta al driver si sabe responder y, si no,
 * cae al mapa declarado.
 *
 * Un fallo del sondeo (router inalcanzable, SSH caído) **no** se convierte en
 * «tu router no puede»: eso sería acusar al hardware de un problema de red y dejar
 * al usuario persiguiendo el problema equivocado. Se responde con el techo
 * declarado, que es lo único que se sabe con certeza en ese momento.
 */
export async function resolvePerDeviceTraffic(driver: {
  kind: DriverKind;
  perDeviceTrafficCapability?: () => Promise<PerDeviceTrafficCapability>;
}): Promise<PerDeviceTrafficCapability> {
  if (!driver.perDeviceTrafficCapability) return declaredCapability(driver.kind);
  try {
    return await driver.perDeviceTrafficCapability();
  } catch {
    return declaredCapability(driver.kind);
  }
}
