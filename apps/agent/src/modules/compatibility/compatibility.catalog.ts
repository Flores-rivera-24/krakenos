import {
  type CompatCapability,
  type CompatCategory,
  type CompatibilityEntry,
  type CompatRequirement,
  COMPAT_CATEGORIES,
} from '@krakenos/types';
import { IOT_SUPPORT_LEVEL, type DriverKind, type IntegrationField, type IotKind } from '@krakenos/types';
import { INTEGRATION_SCHEMA } from '../../integrations/schema.js';
import { reportsPerDeviceTraffic } from '../../drivers/capabilities.js';

/**
 * Catálogo de compatibilidad (US-208) **derivado del código**: recorre el catálogo
 * de integraciones (`INTEGRATION_SCHEMA`, fuente única de kinds/labels/campos) y
 * anota las capacidades por categoría. No hay lista duplicada a mano; añadir un
 * backend nuevo al schema lo hace aparecer aquí solo.
 */

/** Capacidades base por categoría (dominio). El WiFi del driver se añade por flag. */
const CATEGORY_CAPABILITIES: Record<CompatCategory, CompatCapability[]> = {
  driver: ['inventory', 'block', 'traffic'],
  iot: ['control'],
  cameras: ['camera-stream', 'camera-snapshot'],
  vpn: ['vpn'],
  firewall: ['firewall'],
  vlan: ['vlan'],
  qos: ['qos'],
  dns: ['dns-block'],
};

/**
 * Kinds que exigen una **dependencia opcional** en el servidor (no viaja en la
 * imagen). Co-localizado y pequeño; refleja los `import` perezosos del código.
 */
const EXTRA_DEP_KINDS = new Set<string>([
  'driver:openwrt',
  'driver:mikrotik',
  'driver:asus',
  'iot:zigbee',
  'iot:mqtt',
  'iot:meross',
  'iot:matter',
  'iot:tuya',
  'vlan:switch',
  'cameras:rtsp',
]);

/**
 * Kinds cuya capacidad de **tráfico por dispositivo** depende de un paquete en el
 * ROUTER (US-251), no en el servidor. Hoy solo OpenWrt con `nlbwmon`.
 */
const ROUTER_PACKAGE_KINDS = new Set<string>(['driver:openwrt']);

/** Deriva los requisitos de puesta en marcha de los campos del schema. */
function deriveRequirements(id: string, fields: IntegrationField[]): CompatRequirement[] {
  const reqs = new Set<CompatRequirement>();
  for (const f of fields) {
    if (f.secret) reqs.add('credentials');
    else if (f.required && (f.type === 'host' || f.type === 'url')) reqs.add('address');
  }
  if (EXTRA_DEP_KINDS.has(id)) reqs.add('extra-dependency');
  if (ROUTER_PACKAGE_KINDS.has(id)) reqs.add('router-package');
  return [...reqs];
}

/** Construye el catálogo de compatibilidad completo, ordenado por nombre. */
export function buildCompatibilityCatalog(): CompatibilityEntry[] {
  const entries: CompatibilityEntry[] = [];
  for (const category of COMPAT_CATEGORIES) {
    const kinds = INTEGRATION_SCHEMA[category];
    for (const [kind, schema] of Object.entries(kinds)) {
      // Solo el `mock` es el modo demostración; los backends `zeroConfig` (Tuya,
      // Govee…) son hardware real que simplemente no necesita config para activarse.
      if (kind === 'mock') continue;
      const id = `${category}:${kind}`;
      const capabilities: CompatCapability[] = [...CATEGORY_CAPABILITIES[category]];
      if (category === 'driver' && schema.wifiSupported) capabilities.push('wifi');
      // US-263: honestidad de catálogo. El desglose por aparato NO es lo mismo que
      // medir el tráfico del hogar; declararlo solo donde de verdad existe evita
      // prometer un bienestar digital que saldría vacío.
      // US-251: OpenWrt ya lo tiene, pero **a través de `nlbwmon`**, que es un
      // paquete aparte del router. Se declara la capacidad y se marca el requisito,
      // porque «lo soporta» sin decir «hay que instalar algo» sería la misma media
      // verdad que esta capacidad vino a quitar.
      if (category === 'driver' && reportsPerDeviceTraffic(kind as DriverKind)) {
        capabilities.push('traffic-per-device');
      }
      entries.push({
        id,
        category,
        label: schema.label,
        capabilities,
        requirements: deriveRequirements(id, schema.fields),
        // Nada verificado con hardware real todavía (checklist US-86).
        verified: false,
        // Fuente única en `@krakenos/types`: el asistente de la web lee el mismo
        // mapa, así que no pueden discrepar. Los demás dominios (SSH, REST local,
        // SNMP, RTSP, WireGuard, tc, Pi-hole) son protocolo abierto por construcción.
        support: category === 'iot' ? IOT_SUPPORT_LEVEL[kind as IotKind] : 'core',
      });
    }
  }
  return entries.sort((a, b) => a.label.localeCompare(b.label));
}
