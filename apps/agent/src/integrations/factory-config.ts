import type { IntegrationConfigValues, IntegrationDomain } from '@krakenos/types';
import { env } from '../config/env.js';
import type { createCameraManager } from '../cameras/index.js';
import type { createDnsManager } from '../dns/index.js';
import type { createDriver } from '../drivers/index.js';
import type { createFirewallManager } from '../firewall/index.js';
import type { createIotManager } from '../iot/index.js';
import type { createQosManager } from '../qos/index.js';
import type { createVlanManager } from '../vlan/index.js';
import type { createVpnManager } from '../vpn/index.js';
import type { MerossDeviceConfig } from '../iot/meross.parsers.js';
import type { ShellyDeviceConfig } from '../iot/shelly.parsers.js';
import { iotBackends } from './schema.js';

/**
 * Traduce la config **guardada** (valores planos por clave) al **objeto que espera
 * cada factory** (US-140). Reusa `env.<dominio>` como base estructural, de modo que
 * los campos de despliegue (rutas del helper sudo, stores, `useSudo`…) se conservan
 * de los defaults de `env` y el usuario solo sobrescribe los campos de conexión desde
 * la UI. Sin registro guardado → se devuelve `env.<dominio>` intacto (precedencia:
 * DB sobre `.env`, con `.env` como fallback y compatibilidad hacia atrás).
 */

type Env = typeof env;

export type DriverConfigArg = Parameters<typeof createDriver>[0];
export type VpnConfigArg = Parameters<typeof createVpnManager>[0];
export type IotConfigArg = Parameters<typeof createIotManager>[0];
export type CameraConfigArg = Parameters<typeof createCameraManager>[0];
export type FirewallConfigArg = Parameters<typeof createFirewallManager>[0];
export type VlanConfigArg = Parameters<typeof createVlanManager>[0];
export type QosConfigArg = Parameters<typeof createQosManager>[0];
export type DnsConfigArg = Parameters<typeof createDnsManager>[0];

/** Registro efectivo de un dominio: `kind` + valores (con secretos ya descifrados). */
export interface DomainRecord {
  kind: string;
  values: IntegrationConfigValues;
}

// --- Coerciones tolerantes (los valores llegan como string|number|boolean) ---
const str = (v: unknown, fallback: string): string =>
  typeof v === 'string' && v.trim() !== '' ? v : fallback;
const optStr = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() !== '' ? v : undefined;
const num = (v: unknown, fallback: number): number => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
};
const bool = (v: unknown, fallback: boolean): boolean =>
  typeof v === 'boolean' ? v : v === 'true' ? true : v === 'false' ? false : fallback;
const csvIps = (v: unknown): string[] =>
  typeof v === 'string'
    ? v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

function parseShellyDevices(raw: unknown): ShellyDeviceConfig[] {
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((d): d is Record<string, unknown> => Boolean(d) && typeof d === 'object')
      .map(
        (d): ShellyDeviceConfig => ({
          ip: String(d.ip ?? ''),
          name: typeof d.name === 'string' ? d.name : undefined,
          gen: d.gen === 2 ? 2 : 1,
          channels: typeof d.channels === 'number' ? d.channels : undefined,
          type: d.type === 'light' ? 'light' : 'relay',
        }),
      )
      .filter((d) => d.ip.length > 0);
  } catch {
    return [];
  }
}

function parseMerossDevices(raw: unknown): MerossDeviceConfig[] {
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((d): d is Record<string, unknown> => Boolean(d) && typeof d === 'object')
      .map(
        (d): MerossDeviceConfig => ({
          uuid: String(d.uuid ?? ''),
          name: typeof d.name === 'string' ? d.name : undefined,
          channels: typeof d.channels === 'number' ? d.channels : undefined,
          key: String(d.key ?? ''),
        }),
      )
      .filter((d) => d.uuid.length > 0 && d.key.length > 0);
  } catch {
    return [];
  }
}

export function resolveDriverConfig(
  record: DomainRecord | null,
  base: Env['driver'] = env.driver,
): DriverConfigArg {
  if (!record) return base;
  const v = record.values;
  const kind = record.kind as DriverConfigArg['kind'];
  const host = str(v.host, base.host ?? '');
  switch (kind) {
    case 'openwrt':
      return {
        ...base,
        kind,
        host,
        openwrt: {
          ...base.openwrt,
          wanInterface: str(v.wanInterface, base.openwrt.wanInterface),
          guestNetwork: str(v.guestNetwork, base.openwrt.guestNetwork),
          ssh: {
            ...base.openwrt.ssh,
            host,
            port: num(v.sshPort, base.openwrt.ssh.port),
            username: str(v.username, base.openwrt.ssh.username),
            password: optStr(v.password) ?? base.openwrt.ssh.password,
          },
        },
      };
    case 'asus':
      return {
        ...base,
        kind,
        host,
        asus: {
          ...base.asus,
          host,
          username: str(v.username, base.asus.username),
          password: str(v.password, base.asus.password),
          https: bool(v.https, base.asus.https),
        },
      };
    case 'unifi':
      return {
        ...base,
        kind,
        host,
        unifi: {
          ...base.unifi,
          url: str(v.url, base.unifi.url),
          username: str(v.username, base.unifi.username),
          password: str(v.password, base.unifi.password),
          site: str(v.site, base.unifi.site),
        },
      };
    case 'omada':
      return {
        ...base,
        kind,
        host,
        omada: {
          ...base.omada,
          url: str(v.url, base.omada.url),
          username: str(v.username, base.omada.username),
          password: str(v.password, base.omada.password),
          siteName: str(v.siteName, base.omada.siteName),
          omadacId: optStr(v.omadacId) ?? base.omada.omadacId,
        },
      };
    case 'mikrotik':
      return {
        ...base,
        kind,
        host,
        mikrotik: {
          ...base.mikrotik,
          mode: v.mode === 'ssh' ? 'ssh' : 'rest',
          host: str(v.host, base.mikrotik.host),
          username: str(v.username, base.mikrotik.username),
          password: str(v.password, base.mikrotik.password),
          wanInterface: str(v.wanInterface, base.mikrotik.wanInterface),
          https: bool(v.https, base.mikrotik.https),
          sshPort: num(v.sshPort, base.mikrotik.sshPort),
        },
      };
    case 'pfsense':
      return {
        ...base,
        kind,
        host,
        pfsense: {
          ...base.pfsense,
          baseUrl: str(v.baseUrl, base.pfsense.baseUrl),
          apiKey: str(v.apiKey, base.pfsense.apiKey),
          wanInterface: str(v.wanInterface, base.pfsense.wanInterface),
          lanInterface: str(v.lanInterface, base.pfsense.lanInterface),
        },
      };
    case 'cisco-ios':
      return {
        ...base,
        kind,
        host,
        ciscoIos: {
          ...base.ciscoIos,
          interface: str(v.interface, base.ciscoIos.interface),
          vlan: str(v.vlan, base.ciscoIos.vlan),
          ssh: {
            ...base.ciscoIos.ssh,
            host,
            port: num(v.sshPort, base.ciscoIos.ssh.port),
            username: str(v.username, base.ciscoIos.ssh.username),
            password: optStr(v.password) ?? base.ciscoIos.ssh.password,
            enablePassword: optStr(v.enablePassword) ?? base.ciscoIos.ssh.enablePassword,
          },
        },
      };
    case 'cisco-netconf':
      return {
        ...base,
        kind,
        host,
        ciscoNetconf: {
          ...base.ciscoNetconf,
          interface: str(v.interface, base.ciscoNetconf.interface),
          netconf: {
            ...base.ciscoNetconf.netconf,
            host,
            port: num(v.port, base.ciscoNetconf.netconf.port),
            username: str(v.username, base.ciscoNetconf.netconf.username),
            password: optStr(v.password) ?? base.ciscoNetconf.netconf.password,
          },
        },
      };
    default:
      return { ...base, kind };
  }
}

export function resolveVpnConfig(
  record: DomainRecord | null,
  base: Env['vpn'] = env.vpn,
): VpnConfigArg {
  if (!record) return base;
  const v = record.values;
  return {
    ...base,
    kind: record.kind === 'wireguard' ? 'wireguard' : 'mock',
    endpoint: str(v.endpoint, base.endpoint),
    listenPort: num(v.listenPort, base.listenPort),
    wireguard: {
      ...base.wireguard,
      interface: str(v.interface, base.wireguard.interface),
      subnet: str(v.subnet, base.wireguard.subnet),
      dns: str(v.dns, base.wireguard.dns),
    },
  };
}

export function resolveIotConfig(
  record: DomainRecord | null,
  base: Env['iot'] = env.iot,
): IotConfigArg {
  if (!record) return base;
  const v = record.values;
  const has = (key: string): boolean => Object.prototype.hasOwnProperty.call(v, key);
  const g = (backend: string, field: string): unknown => v[`${backend}.${field}`];
  const cfg: IotConfigArg = { ...base, kind: record.kind };
  for (const backend of iotBackends(record.kind)) {
    switch (backend) {
      case 'hue':
        cfg.hue = {
          url: str(g('hue', 'bridgeUrl'), base.hue.url),
          appKey: str(g('hue', 'appKey'), base.hue.appKey),
        };
        break;
      case 'govee':
        cfg.govee = { listenPort: num(g('govee', 'listenPort'), base.govee.listenPort) };
        break;
      case 'zigbee':
        cfg.zigbee = {
          url: str(g('zigbee', 'brokerUrl'), base.zigbee.url),
          baseTopic: str(g('zigbee', 'baseTopic'), base.zigbee.baseTopic),
          username: optStr(g('zigbee', 'username')) ?? base.zigbee.username,
          password: optStr(g('zigbee', 'password')) ?? base.zigbee.password,
        };
        break;
      case 'matter':
        cfg.matter = { url: str(g('matter', 'serverUrl'), base.matter.url) };
        break;
      case 'kasa':
        cfg.kasa = {
          kasaIps: has('kasa.kasaDeviceIps') ? csvIps(g('kasa', 'kasaDeviceIps')) : base.kasa.kasaIps,
          tapoIps: has('kasa.tapoDeviceIps') ? csvIps(g('kasa', 'tapoDeviceIps')) : base.kasa.tapoIps,
          tapoEmail: optStr(g('kasa', 'tapoEmail')) ?? base.kasa.tapoEmail,
          tapoPassword: optStr(g('kasa', 'tapoPassword')) ?? base.kasa.tapoPassword,
        };
        break;
      case 'shelly':
        cfg.shelly = {
          devices: has('shelly.devices') ? parseShellyDevices(g('shelly', 'devices')) : base.shelly.devices,
          auth: bool(g('shelly', 'auth'), base.shelly.auth),
          username: optStr(g('shelly', 'username')) ?? base.shelly.username,
          password: optStr(g('shelly', 'password')) ?? base.shelly.password,
        };
        break;
      case 'meross':
        cfg.meross = {
          brokerHost: str(g('meross', 'brokerHost'), base.meross.brokerHost),
          brokerPort: num(g('meross', 'brokerPort'), base.meross.brokerPort),
          devices: has('meross.devices') ? parseMerossDevices(g('meross', 'devices')) : base.meross.devices,
        };
        break;
      case 'switchbot':
        cfg.switchbot = {
          host: str(g('switchbot', 'hubHost'), base.switchbot.host),
          port: num(g('switchbot', 'hubPort'), base.switchbot.port),
          token: optStr(g('switchbot', 'token')) ?? base.switchbot.token,
        };
        break;
      default:
        // 'tuya' (gestor de dispositivos propio) y 'mock' no llevan config aquí.
        break;
    }
  }
  return cfg;
}

export function resolveCameraConfig(
  record: DomainRecord | null,
  base: Env['cameras'] = env.cameras,
): CameraConfigArg {
  if (!record) return base;
  const v = record.values;
  return {
    ...base,
    kind: record.kind === 'rtsp' ? 'rtsp' : 'mock',
    rtsp: {
      ...base.rtsp,
      ffmpegPath: str(v.ffmpegPath, base.rtsp.ffmpegPath),
      transport: str(v.transport, base.rtsp.transport),
    },
  };
}

export function resolveFirewallConfig(
  record: DomainRecord | null,
  base: Env['firewall'] = env.firewall,
): FirewallConfigArg {
  if (!record) return base;
  const v = record.values;
  return {
    ...base,
    kind: record.kind === 'iptables' ? 'iptables' : 'mock',
    iptables: { ...base.iptables, chain: str(v.chain, base.iptables.chain) },
  };
}

export function resolveVlanConfig(
  record: DomainRecord | null,
  base: Env['vlan'] = env.vlan,
): VlanConfigArg {
  if (!record) return base;
  const v = record.values;
  const kind = record.kind === 'switch' || record.kind === 'cisco' ? record.kind : 'mock';
  return {
    ...base,
    kind,
    switch: {
      ...base.switch,
      host: str(v.host, base.switch.host),
      community: str(v.community, base.switch.community),
      port: num(v.port, base.switch.port),
    },
    cisco: {
      ...base.cisco,
      host: str(v.host, base.cisco.host),
      port: num(v.port, base.cisco.port),
      username: str(v.username, base.cisco.username),
      password: optStr(v.password) ?? base.cisco.password,
      enablePassword: optStr(v.enablePassword) ?? base.cisco.enablePassword,
    },
  };
}

export function resolveQosConfig(
  record: DomainRecord | null,
  base: Env['qos'] = env.qos,
): QosConfigArg {
  if (!record) return base;
  const v = record.values;
  return {
    ...base,
    kind: record.kind === 'tc' ? 'tc' : 'mock',
    tc: {
      ...base.tc,
      interface: str(v.interface, base.tc.interface),
      linkKbit: num(v.linkKbit, base.tc.linkKbit),
    },
  };
}

export function resolveDnsConfig(
  record: DomainRecord | null,
  base: Env['dns'] = env.dns,
): DnsConfigArg {
  if (!record) return base;
  const v = record.values;
  return {
    ...base,
    kind: record.kind === 'pihole' ? 'pihole' : 'mock',
    pihole: {
      ...base.pihole,
      baseUrl: str(v.baseUrl, base.pihole.baseUrl),
      password: optStr(v.password) ?? base.pihole.password,
    },
  };
}

/** Construye el objeto de config del factory de `domain` a partir de un registro. */
export function buildConfigForDomain(domain: IntegrationDomain, record: DomainRecord | null): unknown {
  switch (domain) {
    case 'driver':
      return resolveDriverConfig(record);
    case 'vpn':
      return resolveVpnConfig(record);
    case 'iot':
      return resolveIotConfig(record);
    case 'cameras':
      return resolveCameraConfig(record);
    case 'firewall':
      return resolveFirewallConfig(record);
    case 'vlan':
      return resolveVlanConfig(record);
    case 'qos':
      return resolveQosConfig(record);
    case 'dns':
      return resolveDnsConfig(record);
    default: {
      const exhaustive: never = domain;
      throw new Error(`Dominio de integración desconocido: ${String(exhaustive)}`);
    }
  }
}
