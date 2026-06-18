import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DriverKind } from '@krakenos/types';

/** Lee una variable obligatoria o lanza al arrancar. */
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta la variable de entorno obligatoria: ${name}`);
  }
  return value;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`La variable ${name} debe ser un entero, recibido: ${raw}`);
  }
  return parsed;
}

const driverKind = (process.env.DRIVER_KIND ?? 'mock') as DriverKind;

/**
 * TLS opcional. Si `HTTPS_ENABLED=true`, lee el cert/clave (genera con
 * scripts/gen-cert.sh). En desarrollo se deja en HTTP.
 */
const httpsEnabled = process.env.HTTPS_ENABLED === 'true';
const https = httpsEnabled
  ? {
      key: readFileSync(resolve(required('TLS_KEY_PATH')), 'utf8'),
      cert: readFileSync(resolve(required('TLS_CERT_PATH')), 'utf8'),
    }
  : null;

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProd: process.env.NODE_ENV === 'production',
  port: int('PORT', 3001),
  host: process.env.HOST ?? '0.0.0.0',
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',

  accessTokenTtl: int('ACCESS_TOKEN_TTL', 900),
  refreshTokenTtl: int('REFRESH_TOKEN_TTL', 2_592_000),

  /** Claves RS256 leídas desde disco al arrancar. */
  jwtPrivateKey: readFileSync(resolve(required('JWT_PRIVATE_KEY_PATH')), 'utf8'),
  jwtPublicKey: readFileSync(resolve(required('JWT_PUBLIC_KEY_PATH')), 'utf8'),

  driver: {
    kind: driverKind,
    host: process.env.DRIVER_HOST || undefined,
    // Solo se usa cuando DRIVER_KIND=openwrt (driver real vía SSH+UCI).
    openwrt: {
      wanInterface: process.env.OPENWRT_WAN_IFACE ?? 'wan',
      guestNetwork: process.env.OPENWRT_GUEST_NETWORK ?? 'guest',
      ssh: {
        host: process.env.DRIVER_HOST ?? '',
        port: int('OPENWRT_SSH_PORT', 22),
        username: process.env.OPENWRT_SSH_USER ?? 'root',
        password: process.env.OPENWRT_SSH_PASSWORD || undefined,
        privateKey: process.env.OPENWRT_SSH_KEY_PATH
          ? readFileSync(resolve(process.env.OPENWRT_SSH_KEY_PATH), 'utf8')
          : undefined,
      },
    },
    // Solo se usa cuando DRIVER_KIND=pfsense (driver real vía REST API v2).
    pfsense: {
      baseUrl: process.env.PFSENSE_URL ?? (process.env.DRIVER_HOST ? `https://${process.env.DRIVER_HOST}` : ''),
      apiKey: process.env.PFSENSE_API_KEY ?? '',
      wanInterface: process.env.PFSENSE_WAN_IFACE ?? 'wan',
      lanInterface: process.env.PFSENSE_LAN_IFACE ?? 'lan',
    },
  },

  vpn: {
    kind: (process.env.VPN_KIND ?? 'mock') as 'mock' | 'wireguard',
    endpoint: process.env.VPN_ENDPOINT ?? 'vpn.krakenos.local',
    listenPort: int('VPN_LISTEN_PORT', 51820),
    // Solo se usa cuando VPN_KIND=wireguard (gestor real).
    wireguard: {
      interface: process.env.WG_INTERFACE ?? 'wg0',
      subnet: process.env.WG_SUBNET ?? '10.8.0.0/24',
      dns: process.env.WG_DNS ?? '10.8.0.1',
      helperPath: process.env.WG_HELPER_PATH ?? '/usr/local/bin/krakenos-helper',
      useSudo: (process.env.WG_USE_SUDO ?? 'true') !== 'false',
      peerStorePath: process.env.WG_PEER_STORE ?? resolve('data/wg-peers.json'),
      serverPublicKey: process.env.WG_SERVER_PUBLIC_KEY || undefined,
    },
  },

  iot: {
    kind: (process.env.IOT_KIND ?? 'mock') as 'mock' | 'zigbee' | 'matter',
    // Solo se usa cuando IOT_KIND=zigbee (zigbee2mqtt vía MQTT).
    zigbee: {
      url: process.env.ZIGBEE2MQTT_URL ?? 'mqtt://localhost:1883',
      baseTopic: process.env.ZIGBEE2MQTT_BASE_TOPIC ?? 'zigbee2mqtt',
      username: process.env.ZIGBEE2MQTT_USERNAME || undefined,
      password: process.env.ZIGBEE2MQTT_PASSWORD || undefined,
    },
    // Solo se usa cuando IOT_KIND=matter (python-matter-server, API WebSocket).
    matter: {
      url: process.env.MATTER_SERVER_URL ?? 'ws://localhost:5580/ws',
    },
  },

  cameras: {
    kind: (process.env.CAMERAS_KIND ?? 'mock') as 'mock' | 'rtsp',
    // Solo se usa cuando CAMERAS_KIND=rtsp (snapshot vía ffmpeg).
    rtsp: {
      configPath: process.env.CAMERAS_CONFIG ?? resolve('data/cameras.json'),
      ffmpegPath: process.env.FFMPEG_PATH ?? 'ffmpeg',
      transport: process.env.CAMERAS_RTSP_TRANSPORT ?? 'tcp',
    },
  },

  firewall: {
    kind: (process.env.FIREWALL_KIND ?? 'mock') as 'mock' | 'iptables',
    // Solo se usa cuando FIREWALL_KIND=iptables (gestor real).
    iptables: {
      chain: process.env.FW_CHAIN ?? 'KRAKENOS',
      helperPath: process.env.FW_HELPER_PATH ?? '/usr/local/bin/krakenos-helper',
      useSudo: (process.env.FW_USE_SUDO ?? 'true') !== 'false',
      ruleStorePath: process.env.FW_RULE_STORE ?? resolve('data/firewall-rules.json'),
    },
  },

  vlan: {
    kind: (process.env.VLAN_KIND ?? 'mock') as 'mock' | 'switch',
    // Solo se usa cuando VLAN_KIND=switch (switch gestionado vía SNMP).
    switch: {
      host: process.env.VLAN_SWITCH_HOST ?? '',
      community: process.env.VLAN_SWITCH_COMMUNITY ?? 'private',
      port: int('VLAN_SWITCH_SNMP_PORT', 161),
      storePath: process.env.VLAN_STORE ?? resolve('data/vlans.json'),
    },
  },

  qos: {
    kind: (process.env.QOS_KIND ?? 'mock') as 'mock' | 'tc',
    // Solo se usa cuando QOS_KIND=tc (gestor real).
    tc: {
      interface: process.env.TC_INTERFACE ?? 'eth0',
      linkKbit: int('TC_LINK_KBIT', 1_000_000),
      helperPath: process.env.TC_HELPER_PATH ?? '/usr/local/bin/krakenos-helper',
      useSudo: (process.env.TC_USE_SUDO ?? 'true') !== 'false',
      ruleStorePath: process.env.TC_RULE_STORE ?? resolve('data/qos-rules.json'),
    },
  },

  dns: {
    kind: (process.env.DNS_KIND ?? 'mock') as 'mock' | 'pihole',
    // Solo se usa cuando DNS_KIND=pihole (gestor real, API REST de Pi-hole v6).
    pihole: {
      baseUrl: process.env.PIHOLE_URL ?? 'http://pi.hole',
      password: process.env.PIHOLE_PASSWORD || undefined,
    },
  },

  /** Config TLS (`{ key, cert }`) o `null` si el agente corre en HTTP. */
  https,
} as const;
