import type { DriverKind } from '@krakenos/types';

/**
 * Capacidades **declaradas** de cada driver (US-263).
 *
 * ## Por qué existe esto
 *
 * `getTrafficSample()` devuelve `{ wan, devices }`. El array `devices` es la
 * **única** fuente de `DeviceTrafficSample`, y de ahí cuelgan el desglose «Por
 * dispositivo» de Tráfico y **todo** el bienestar digital (US-184).
 *
 * Los **ocho drivers reales devuelven `devices: []`**; solo el `mock` lo rellena.
 * Es decir: en cualquier casa real esas dos features están vacías, y hasta ahora la
 * UI lo explicaba diciendo «asigna un dueño a los dispositivos» — mandando al
 * usuario a configurar algo que no arregla nada.
 *
 * ## Por qué DECLARADO y no deducido
 *
 * Un `devices: []` en tiempo de ejecución es ambiguo: puede significar «este driver
 * no sabe» o «ahora mismo no hay tráfico». Justo el día que el usuario estrena la
 * instalación —cuando más confundido está— las dos son indistinguibles. La
 * declaración es inequívoca desde el primer segundo.
 *
 * El mapa es **exhaustivo sobre `DriverKind`**: añadir un driver no compila hasta
 * declarar si reporta el desglose, y `drivers-capabilities.test.ts` comprueba que
 * lo declarado coincide con lo que el código hace de verdad.
 *
 * El arreglo de fondo —que los drivers **sí** reporten— es **US-251** (nlbwmon
 * sobre el SSH que ya existe cubre OpenWrt; el resto necesita su propia vía).
 */
export const PER_DEVICE_TRAFFIC_BY_KIND: Record<DriverKind, boolean> = {
  // El único que lo rellena hoy, y es simulado (`mock.driver.ts`).
  mock: true,
  // Los ocho reales devuelven `devices: []` de forma literal. → US-251.
  openwrt: false,
  pfsense: false,
  'cisco-ios': false,
  'cisco-netconf': false,
  unifi: false,
  mikrotik: false,
  omada: false,
  asus: false,
};

/**
 * ¿Reporta este driver el desglose de tráfico **por dispositivo**? Si no, el
 * bienestar digital y la tabla «Por dispositivo» no pueden tener datos, y la UI
 * debe decir **eso** en vez de «todavía no hay datos».
 */
export function reportsPerDeviceTraffic(kind: DriverKind): boolean {
  return PER_DEVICE_TRAFFIC_BY_KIND[kind] ?? false;
}
