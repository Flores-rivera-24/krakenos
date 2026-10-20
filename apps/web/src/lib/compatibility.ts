import type {
  AppDependencyReason,
  CompatCapability,
  CompatCategory,
  CompatEntryId,
  CompatRequirement,
  CompatibilityEntry,
} from '@krakenos/types';
import { api } from '@/lib/api';
import type { TranslationKey } from '@/lib/i18n';
import '@/lib/i18n/catalog/fragments/conectar';

/** Catálogo de compatibilidad de hardware (US-208), derivado del código. */
export const listCompatibility = () => api.getList<CompatibilityEntry>('/compatibility');

/**
 * Etiquetas de la ficha de compatibilidad. Son `Record<Unión, TranslationKey>`
 * **exhaustivos a propósito**: añadir un miembro a la unión de `@krakenos/types`
 * **no compila** hasta darle su clave aquí. Antes la clave se componía con una
 * plantilla (`` t(`compat.cap.${c}` as TranslationKey) ``): el cast ocultaba que
 * faltaba `compat.cap.traffic-per-device` y la ficha de OpenWrt enseñaba la clave
 * cruda.
 */
export const ETIQUETA_DE_CAPACIDAD: Record<CompatCapability, TranslationKey> = {
  inventory: 'compat.cap.inventory',
  block: 'compat.cap.block',
  traffic: 'compat.cap.traffic',
  'traffic-per-device': 'compat.cap.traffic-per-device',
  wifi: 'compat.cap.wifi',
  control: 'compat.cap.control',
  vpn: 'compat.cap.vpn',
  firewall: 'compat.cap.firewall',
  vlan: 'compat.cap.vlan',
  qos: 'compat.cap.qos',
  'dns-block': 'compat.cap.dns-block',
  'camera-stream': 'compat.cap.camera-stream',
  'camera-snapshot': 'compat.cap.camera-snapshot',
};

export const ETIQUETA_DE_REQUISITO: Record<CompatRequirement, TranslationKey> = {
  address: 'compat.req.address',
  credentials: 'compat.req.credentials',
  'extra-dependency': 'compat.req.extra-dependency',
  'router-package': 'compat.req.router-package',
};

export const ETIQUETA_DE_CATEGORIA: Record<CompatCategory, TranslationKey> = {
  driver: 'compat.cat.driver',
  iot: 'compat.cat.iot',
  cameras: 'compat.cat.cameras',
  vpn: 'compat.cat.vpn',
  firewall: 'compat.cat.firewall',
  vlan: 'compat.cat.vlan',
  qos: 'compat.cat.qos',
  dns: 'compat.cat.dns',
};

export const ETIQUETA_DE_DEPENDENCIA: Record<AppDependencyReason, TranslationKey> = {
  pairing: 'compat.app.pairing',
  account: 'compat.app.account',
  'enable-local': 'compat.app.enable-local',
};

/**
 * Nombre visible de cada ficha. El agente manda el **id** (`<categoría>:<kind>`) y no
 * el nombre: escrito en español («Cámaras RTSP», «Switch gestionado (SNMP)»…) no se
 * podía traducir y con la interfaz en inglés salía en español. Exhaustivo sobre
 * `CompatEntryId`, que se deriva de los `*Kind`: un backend nuevo no compila hasta
 * tener nombre aquí (y la clave no existe hasta estar en los dos catálogos).
 */
export const NOMBRE_DE_FICHA: Record<CompatEntryId, TranslationKey> = {
  'driver:openwrt': 'compat.name.driver.openwrt',
  'driver:asus': 'compat.name.driver.asus',
  'driver:unifi': 'compat.name.driver.unifi',
  'driver:omada': 'compat.name.driver.omada',
  'driver:mikrotik': 'compat.name.driver.mikrotik',
  'driver:pfsense': 'compat.name.driver.pfsense',
  'vpn:wireguard': 'compat.name.vpn.wireguard',
  'iot:hue': 'compat.name.iot.hue',
  'iot:govee': 'compat.name.iot.govee',
  'iot:mqtt': 'compat.name.iot.mqtt',
  'iot:zigbee': 'compat.name.iot.zigbee',
  'iot:matter': 'compat.name.iot.matter',
  'iot:tuya': 'compat.name.iot.tuya',
  'iot:kasa': 'compat.name.iot.kasa',
  'iot:shelly': 'compat.name.iot.shelly',
  'iot:meross': 'compat.name.iot.meross',
  'cameras:rtsp': 'compat.name.cameras.rtsp',
  'cameras:frigate': 'compat.name.cameras.frigate',
  'firewall:iptables': 'compat.name.firewall.iptables',
  'vlan:switch': 'compat.name.vlan.switch',
  'qos:tc': 'compat.name.qos.tc',
  'dns:pihole': 'compat.name.dns.pihole',
};

type Traducir = (key: TranslationKey, params?: Record<string, string | number>) => string;

/**
 * Texto de un valor del contrato que llega del servidor. Si un agente más nuevo
 * anuncia uno que esta web no conoce, se **declara** («No reconocido (x)») en vez
 * de pintar el identificador crudo o una clave de catálogo.
 */
export function etiquetaCompat(
  mapa: Readonly<Record<string, TranslationKey>>,
  valor: string,
  t: Traducir,
): string {
  const key = Object.prototype.hasOwnProperty.call(mapa, valor) ? mapa[valor] : undefined;
  return key ? t(key) : t('compat.unknown', { value: valor });
}
