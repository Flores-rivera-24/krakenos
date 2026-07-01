import type {
  IntegrationDomain,
  IntegrationField,
  IntegrationFieldType,
  IntegrationKindSchema,
} from '@krakenos/types';

/**
 * Catálogo técnico de configuración de integraciones (US-140).
 *
 * Fuente de verdad de **qué config necesita cada `kind`** de cada dominio: claves,
 * tipos, cuáles son secretos (se cifran en reposo) y valores por defecto. Debe
 * coincidir con lo que espera el builder de config del agente (`factory-config.ts`)
 * y con `env.ts` (fallback). La copia de usuario (títulos, ayudas, pasos) vive aparte
 * en las guías de la web (`apps/web/src/lib/guides`).
 *
 * Dominio `iot`: puede haber **varios backends a la vez** (luces + enchufes…). Sus
 * valores usan claves **namespaced** `backend.campo` (p. ej. `hue.appKey`), y el `kind`
 * guardado es la lista CSV de backends activos (`hue,govee`). El resto de dominios
 * tienen un único `kind` activo con claves de campo planas.
 */

// Builders concisos para declarar campos sin repetir `required`.
const req = (
  key: string,
  type: IntegrationFieldType,
  extra: Partial<IntegrationField> = {},
): IntegrationField => ({ key, type, required: true, ...extra });
const opt = (
  key: string,
  type: IntegrationFieldType,
  extra: Partial<IntegrationField> = {},
): IntegrationField => ({ key, type, required: false, ...extra });
const secret = (key: string, extra: Partial<IntegrationField> = {}): IntegrationField => ({
  key,
  type: 'password',
  required: true,
  secret: true,
  ...extra,
});

const schema = (
  domain: IntegrationDomain,
  kind: string,
  label: string,
  fields: IntegrationField[],
  extra: Partial<IntegrationKindSchema> = {},
): IntegrationKindSchema => ({ domain, kind, label, fields, ...extra });

/** Catálogo completo: `INTEGRATION_SCHEMA[domain][kind]`. */
export const INTEGRATION_SCHEMA: Record<
  IntegrationDomain,
  Record<string, IntegrationKindSchema>
> = {
  driver: {
    mock: schema('driver', 'mock', 'Modo demostración', [], {
      zeroConfig: true,
      wifiSupported: true,
    }),
    openwrt: schema(
      'driver',
      'openwrt',
      'Router OpenWrt',
      [
        req('host', 'host'),
        opt('sshPort', 'number', { default: 22 }),
        opt('username', 'text', { default: 'root' }),
        secret('password'),
        opt('wanInterface', 'text', { default: 'wan' }),
        opt('guestNetwork', 'text', { default: 'guest' }),
      ],
      { wifiSupported: true },
    ),
    asus: schema(
      'driver',
      'asus',
      'Router ASUS',
      [
        req('host', 'host'),
        opt('username', 'text', { default: 'admin' }),
        secret('password'),
        opt('https', 'boolean', { default: false }),
      ],
      { wifiSupported: true },
    ),
    unifi: schema(
      'driver',
      'unifi',
      'UniFi Network',
      [
        req('url', 'url'),
        opt('username', 'text', { default: 'admin' }),
        secret('password'),
        opt('site', 'text', { default: 'default' }),
      ],
      { wifiSupported: true },
    ),
    omada: schema(
      'driver',
      'omada',
      'TP-Link Omada',
      [
        req('url', 'url'),
        opt('username', 'text', { default: 'admin' }),
        secret('password'),
        opt('siteName', 'text', { default: 'Default' }),
        opt('omadacId', 'text'),
      ],
      { wifiSupported: true },
    ),
    mikrotik: schema(
      'driver',
      'mikrotik',
      'MikroTik RouterOS',
      [
        opt('mode', 'select', {
          default: 'rest',
          options: [
            { value: 'rest', label: 'REST (RouterOS 7)' },
            { value: 'ssh', label: 'SSH' },
          ],
        }),
        req('host', 'host'),
        opt('username', 'text', { default: 'admin' }),
        secret('password'),
        opt('wanInterface', 'text', { default: 'ether1' }),
        opt('https', 'boolean', { default: true }),
        opt('sshPort', 'number', { default: 22 }),
      ],
      { wifiSupported: true },
    ),
    pfsense: schema('driver', 'pfsense', 'pfSense', [
      req('baseUrl', 'url'),
      secret('apiKey'),
      opt('wanInterface', 'text', { default: 'wan' }),
      opt('lanInterface', 'text', { default: 'lan' }),
    ]),
    'cisco-ios': schema('driver', 'cisco-ios', 'Cisco IOS', [
      req('host', 'host'),
      opt('sshPort', 'number', { default: 22 }),
      opt('username', 'text', { default: 'admin' }),
      secret('password'),
      secret('enablePassword', { required: false }),
      opt('interface', 'text', { default: 'GigabitEthernet0/0' }),
      opt('vlan', 'text', { default: '1' }),
    ]),
    'cisco-netconf': schema('driver', 'cisco-netconf', 'Cisco IOS-XE (NETCONF)', [
      req('host', 'host'),
      opt('port', 'number', { default: 830 }),
      opt('username', 'text', { default: 'admin' }),
      secret('password'),
      opt('interface', 'text', { default: 'GigabitEthernet1' }),
    ]),
  },

  vpn: {
    mock: schema('vpn', 'mock', 'Modo demostración', [], { zeroConfig: true }),
    wireguard: schema('vpn', 'wireguard', 'WireGuard', [
      opt('endpoint', 'host', { default: 'vpn.krakenos.local' }),
      opt('listenPort', 'number', { default: 51820 }),
      opt('subnet', 'text', { default: '10.8.0.0/24' }),
      opt('dns', 'text', { default: '10.8.0.1' }),
      opt('interface', 'text', { default: 'wg0' }),
    ]),
  },

  iot: {
    mock: schema('iot', 'mock', 'Modo demostración', [], { zeroConfig: true }),
    hue: schema('iot', 'hue', 'Philips Hue', [req('bridgeUrl', 'url'), secret('appKey')]),
    govee: schema('iot', 'govee', 'Govee', [opt('listenPort', 'number', { default: 4002 })]),
    zigbee: schema('iot', 'zigbee', 'Zigbee2MQTT', [
      req('brokerUrl', 'url', { default: 'mqtt://localhost:1883' }),
      opt('baseTopic', 'text', { default: 'zigbee2mqtt' }),
      opt('username', 'text'),
      secret('password', { required: false }),
    ]),
    matter: schema('iot', 'matter', 'Matter', [
      req('serverUrl', 'url', { default: 'ws://localhost:5580/ws' }),
    ]),
    tuya: schema('iot', 'tuya', 'Tuya / Smart Life', [], {
      // Los focos Tuya se registran uno a uno con su gestor propio (/api/iot/tuya);
      // aquí basta con activar el backend.
      zeroConfig: true,
    }),
    // Un solo backend `kasa` cubre Kasa (autodescubrible) y Tapo (cuenta TP-Link),
    // igual que el manager real (createIotManager kind `kasa` gestiona ambos).
    kasa: schema('iot', 'kasa', 'TP-Link Kasa / Tapo', [
      opt('kasaDeviceIps', 'text'),
      opt('tapoEmail', 'text'),
      secret('tapoPassword', { required: false }),
      opt('tapoDeviceIps', 'text'),
    ]),
    shelly: schema('iot', 'shelly', 'Shelly', [
      req('devices', 'text'),
      opt('auth', 'boolean', { default: false }),
      opt('username', 'text'),
      secret('password', { required: false }),
    ]),
    meross: schema('iot', 'meross', 'Meross', [
      req('brokerHost', 'host'),
      opt('brokerPort', 'number', { default: 1883 }),
      // La lista de dispositivos incluye la `key` de cada uno → todo el campo es secreto.
      secret('devices', { type: 'text' }),
    ]),
    switchbot: schema('iot', 'switchbot', 'SwitchBot', [
      req('hubHost', 'host'),
      opt('hubPort', 'number', { default: 8123 }),
      secret('token'),
    ]),
  },

  cameras: {
    mock: schema('cameras', 'mock', 'Modo demostración', [], { zeroConfig: true }),
    rtsp: schema('cameras', 'rtsp', 'Cámaras RTSP', [
      opt('transport', 'select', {
        default: 'tcp',
        options: [
          { value: 'tcp', label: 'TCP (recomendado)' },
          { value: 'udp', label: 'UDP' },
        ],
      }),
      opt('ffmpegPath', 'text', { default: 'ffmpeg' }),
    ]),
  },

  firewall: {
    mock: schema('firewall', 'mock', 'Modo demostración', [], { zeroConfig: true }),
    iptables: schema('firewall', 'iptables', 'iptables (Linux)', [
      opt('chain', 'text', { default: 'KRAKENOS' }),
    ]),
  },

  vlan: {
    mock: schema('vlan', 'mock', 'Modo demostración', [], { zeroConfig: true }),
    switch: schema('vlan', 'switch', 'Switch gestionado (SNMP)', [
      req('host', 'host'),
      opt('community', 'text', { default: 'private' }),
      opt('port', 'number', { default: 161 }),
    ]),
    cisco: schema('vlan', 'cisco', 'Switch Cisco (SSH)', [
      req('host', 'host'),
      opt('port', 'number', { default: 22 }),
      opt('username', 'text', { default: 'admin' }),
      secret('password'),
      secret('enablePassword', { required: false }),
    ]),
  },

  qos: {
    mock: schema('qos', 'mock', 'Modo demostración', [], { zeroConfig: true }),
    tc: schema('qos', 'tc', 'Control de tráfico (Linux tc)', [
      opt('interface', 'text', { default: 'eth0' }),
      opt('linkKbit', 'number', { default: 1_000_000 }),
    ]),
  },

  dns: {
    mock: schema('dns', 'mock', 'Modo demostración', [], { zeroConfig: true }),
    pihole: schema('dns', 'pihole', 'Pi-hole', [
      req('baseUrl', 'url', { default: 'http://pi.hole' }),
      secret('password', { required: false }),
    ]),
  },
};

/** Lista ordenada de dominios. */
export const INTEGRATION_DOMAINS: IntegrationDomain[] = [
  'driver',
  'vpn',
  'iot',
  'cameras',
  'firewall',
  'vlan',
  'qos',
  'dns',
];

/** Esquemas de todos los `kind` de un dominio. */
export function listKinds(domain: IntegrationDomain): IntegrationKindSchema[] {
  return Object.values(INTEGRATION_SCHEMA[domain]);
}

/** Esquema de un `kind` concreto, o `undefined` si no existe. */
export function getKindSchema(
  domain: IntegrationDomain,
  kind: string,
): IntegrationKindSchema | undefined {
  return INTEGRATION_SCHEMA[domain][kind];
}

/**
 * Dado un dominio, su `kind` (CSV en `iot`) y las claves de valores presentes, decide
 * cuáles son **secretas**. Para `iot` la clave es `backend.campo`; para el resto es la
 * clave de campo plana. Una clave sin definición conocida se trata como no-secreta.
 */
export function secretKeysFor(
  domain: IntegrationDomain,
  kind: string,
  valueKeys: string[],
): Set<string> {
  const out = new Set<string>();
  for (const valueKey of valueKeys) {
    if (isSecretKey(domain, kind, valueKey)) out.add(valueKey);
  }
  return out;
}

/** ¿La clave de valor `valueKey` es un secreto según el esquema? */
export function isSecretKey(domain: IntegrationDomain, kind: string, valueKey: string): boolean {
  if (domain === 'iot') {
    const dot = valueKey.indexOf('.');
    if (dot < 0) return false;
    const backend = valueKey.slice(0, dot);
    const field = valueKey.slice(dot + 1);
    return Boolean(INTEGRATION_SCHEMA.iot[backend]?.fields.find((f) => f.key === field)?.secret);
  }
  return Boolean(getKindSchema(domain, kind)?.fields.find((f) => f.key === valueKey)?.secret);
}

/** Backends IoT activos a partir del `kind` CSV (`hue,govee` → `['hue','govee']`). */
export function iotBackends(kind: string): string[] {
  return kind
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
}
