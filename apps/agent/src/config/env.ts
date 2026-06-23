import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DriverKind } from '@krakenos/types';
import type { MerossDeviceConfig } from '../iot/meross.parsers.js';
import type { ShellyDeviceConfig } from '../iot/shelly.parsers.js';

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

/**
 * Parsea `TRUST_PROXY` al valor que espera `trustProxy` de Fastify (US-76, F2).
 * Sustituye el antiguo booleano por una configuración **acotada**:
 *   - vacío / `false`            → `false` (no se confía en `X-Forwarded-For`)
 *   - un entero `n`              → confía en `n` saltos (hops) de proxy
 *   - lista `ip[,cidr,keyword]`  → confía solo en esas IPs/CIDRs/preset de proxy
 *   - `true`                     → confía en XFF de CUALQUIER origen (inseguro;
 *                                  se mantiene por compat pero se avisa al arrancar)
 * Confiar en XFF sin un proxy real que lo reescriba permite **falsificar `req.ip`**
 * y burlar el rate limit de login y la auditoría por IP.
 */
export function parseTrustProxy(raw: string | undefined): boolean | number | string[] {
  const v = (raw ?? '').trim();
  if (v === '' || v.toLowerCase() === 'false') return false;
  if (v.toLowerCase() === 'true') return true;
  if (/^\d+$/.test(v)) return Number(v);
  const list = v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length > 0 ? list : false;
}

/** Avisos de configuración de `TRUST_PROXY` (no bloquean el arranque). */
export function trustProxyWarnings(value: boolean | number | string[]): string[] {
  if (value === true) {
    return [
      'TRUST_PROXY=true confía en X-Forwarded-For de CUALQUIER origen: si no hay un ' +
        'proxy inverso que reescriba la cabecera, un cliente puede falsificar su IP y burlar ' +
        'el rate limit de login y la auditoría. Usa un nº de hops (p. ej. TRUST_PROXY=1) o una ' +
        'lista de IPs/CIDRs de proxies de confianza.',
    ];
  }
  return [];
}

/**
 * Lee una lista de rutas (separadas por comas) de claves públicas y devuelve su
 * contenido PEM. Vacío si la variable no está definida. Se usa para las claves
 * **previas** durante la rotación RS256 (US-64): verifican tokens aún válidos
 * firmados con la clave anterior mientras dura el solape.
 */
/**
 * Lee una variable JSON con una lista de dispositivos (`[{ip, …}]`) y devuelve
 * las IPs. Vacío si la variable no está, no es un array o el JSON es inválido.
 * Se usa para `KASA_DEVICES`/`TAPO_DEVICES` (US-68).
 */
function jsonDeviceIps(name: string): string[] {
  const raw = process.env[name];
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((d) => (d && typeof d === 'object' ? (d as { ip?: unknown }).ip : undefined))
      .filter((ip): ip is string => typeof ip === 'string' && ip.length > 0);
  } catch {
    return [];
  }
}

/**
 * Lee `SHELLY_DEVICES` (JSON `[{ip, name?, gen, channels?, type?}]`) y devuelve
 * la lista validada. Vacío si la variable no está o el JSON es inválido (US-69).
 */
function shellyDevices(): ShellyDeviceConfig[] {
  const raw = process.env.SHELLY_DEVICES;
  if (!raw) return [];
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

/**
 * Lee `MEROSS_DEVICES` (JSON `[{uuid, name?, channels?, key}]`) y devuelve la
 * lista validada (descarta entradas sin `uuid` o sin `key`). Vacío si la variable
 * no está o el JSON es inválido (US-71).
 */
function merossDevices(): MerossDeviceConfig[] {
  const raw = process.env.MEROSS_DEVICES;
  if (!raw) return [];
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

function pemList(name: string): string[] {
  const raw = process.env[name];
  if (!raw) return [];
  return raw
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => readFileSync(resolve(p), 'utf8'));
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
  /**
   * Claves públicas **anteriores** (rotación RS256, US-64). Durante el solape se
   * usan solo para verificar tokens firmados con la clave previa; nunca firman.
   * `JWT_PREVIOUS_PUBLIC_KEY_PATHS` = rutas separadas por comas. Ver
   * `docs/jwt-key-rotation.md`.
   */
  jwtPreviousPublicKeys: pemList('JWT_PREVIOUS_PUBLIC_KEY_PATHS'),

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
    // Solo se usa cuando DRIVER_KIND=cisco-ios (driver real vía SSH+CLI de IOS).
    ciscoIos: {
      interface: process.env.CISCO_INTERFACE ?? 'GigabitEthernet0/0',
      vlan: process.env.CISCO_BLOCK_VLAN ?? '1',
      ssh: {
        host: process.env.DRIVER_HOST ?? '',
        port: int('CISCO_SSH_PORT', 22),
        username: process.env.CISCO_USER ?? 'admin',
        password: process.env.CISCO_PASSWORD || undefined,
        enablePassword: process.env.CISCO_ENABLE_PASSWORD || undefined,
      },
    },
    // Solo se usa cuando DRIVER_KIND=cisco-netconf (IOS-XE 16.6+ vía NETCONF, puerto 830).
    ciscoNetconf: {
      interface: process.env.CISCO_INTERFACE ?? 'GigabitEthernet1',
      netconf: {
        host: process.env.CISCO_NETCONF_HOST ?? process.env.DRIVER_HOST ?? '',
        port: int('CISCO_NETCONF_PORT', 830),
        username: process.env.CISCO_NETCONF_USER ?? process.env.CISCO_USER ?? 'admin',
        password: process.env.CISCO_NETCONF_PASSWORD || process.env.CISCO_PASSWORD || undefined,
      },
    },
    // Solo se usa cuando DRIVER_KIND=unifi (API local del controller UniFi Network).
    unifi: {
      url: process.env.UNIFI_URL ?? (process.env.DRIVER_HOST ? `https://${process.env.DRIVER_HOST}` : ''),
      username: process.env.UNIFI_USERNAME ?? 'admin',
      password: process.env.UNIFI_PASSWORD ?? '',
      site: process.env.UNIFI_SITE ?? 'default',
    },
    // Solo se usa cuando DRIVER_KIND=mikrotik (RouterOS, REST o SSH).
    mikrotik: {
      mode: (process.env.MIKROTIK_MODE ?? 'rest') as 'rest' | 'ssh',
      host: process.env.MIKROTIK_HOST ?? process.env.DRIVER_HOST ?? '',
      username: process.env.MIKROTIK_USER ?? 'admin',
      password: process.env.MIKROTIK_PASSWORD ?? '',
      wanInterface: process.env.MIKROTIK_WAN_IFACE ?? 'ether1',
      https: process.env.MIKROTIK_HTTPS !== 'false',
      sshPort: int('MIKROTIK_SSH_PORT', 22),
    },
    // Solo se usa cuando DRIVER_KIND=omada (TP-Link Omada Controller, API local).
    omada: {
      url: process.env.OMADA_URL ?? (process.env.DRIVER_HOST ? `https://${process.env.DRIVER_HOST}` : ''),
      username: process.env.OMADA_USERNAME ?? 'admin',
      password: process.env.OMADA_PASSWORD ?? '',
      siteName: process.env.OMADA_SITE_NAME ?? 'Default',
      omadacId: process.env.OMADA_OMADAC_ID || undefined,
    },
    // Solo se usa cuando DRIVER_KIND=asus (ASUS/Asuswrt-Merlin, appGet.cgi).
    asus: {
      host: process.env.ASUS_HOST ?? process.env.DRIVER_HOST ?? '',
      username: process.env.ASUS_USERNAME ?? 'admin',
      password: process.env.ASUS_PASSWORD ?? '',
      https: process.env.ASUS_HTTPS === 'true',
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
    // Un kind, o varios separados por comas (p. ej. `hue,govee`) → CompositeIotManager.
    kind: process.env.IOT_KIND ?? 'mock',
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
    // Solo se usa cuando IOT_KIND=hue (Philips Hue bridge, CLIP API v2 local).
    hue: {
      url: process.env.HUE_BRIDGE_URL ?? '',
      appKey: process.env.HUE_APP_KEY ?? '',
    },
    // Solo se usa cuando IOT_KIND=govee (API LAN UDP, local-first).
    govee: {
      listenPort: int('GOVEE_LISTEN_PORT', 4002),
    },
    // Solo se usa cuando IOT_KIND=tuya (protocolo Tuya local, focos genéricos).
    tuya: {
      configPath: process.env.TUYA_CONFIG_PATH ?? resolve('data/tuya-devices.json'),
    },
    // Solo se usa cuando IOT_KIND=kasa (TP-Link Kasa/Tapo, protocolo local).
    kasa: {
      kasaIps: jsonDeviceIps('KASA_DEVICES'),
      tapoIps: jsonDeviceIps('TAPO_DEVICES'),
      tapoEmail: process.env.TAPO_EMAIL || undefined,
      tapoPassword: process.env.TAPO_PASSWORD || undefined,
    },
    // Solo se usa cuando IOT_KIND=shelly (Gen1 REST / Gen2 JSON-RPC, local).
    shelly: {
      devices: shellyDevices(),
      auth: process.env.SHELLY_AUTH === 'true',
      username: process.env.SHELLY_USER || undefined,
      password: process.env.SHELLY_PASSWORD || undefined,
    },
    // Solo se usa cuando IOT_KIND=meross (broker MQTT local). Requiere el paquete mqtt.
    meross: {
      brokerHost: process.env.MEROSS_BROKER_HOST ?? '',
      brokerPort: int('MEROSS_BROKER_PORT', 1883),
      devices: merossDevices(),
    },
    // Solo se usa cuando IOT_KIND=switchbot (API REST local del Hub Mini/Hub 2).
    switchbot: {
      host: process.env.SWITCHBOT_HUB_HOST ?? '',
      port: int('SWITCHBOT_HUB_PORT', 8123),
      token: process.env.SWITCHBOT_TOKEN || undefined,
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
    kind: (process.env.VLAN_KIND ?? 'mock') as 'mock' | 'switch' | 'cisco',
    // Solo se usa cuando VLAN_KIND=switch (switch gestionado vía SNMP).
    switch: {
      host: process.env.VLAN_SWITCH_HOST ?? '',
      community: process.env.VLAN_SWITCH_COMMUNITY ?? 'private',
      port: int('VLAN_SWITCH_SNMP_PORT', 161),
      storePath: process.env.VLAN_STORE ?? resolve('data/vlans.json'),
    },
    // Solo se usa cuando VLAN_KIND=cisco (switch Cisco IOS vía SSH+CLI, reusa CISCO_*).
    cisco: {
      host: process.env.DRIVER_HOST ?? '',
      port: int('CISCO_SSH_PORT', 22),
      username: process.env.CISCO_USER ?? 'admin',
      password: process.env.CISCO_PASSWORD || undefined,
      enablePassword: process.env.CISCO_ENABLE_PASSWORD || undefined,
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

  /**
   * Servido del frontend compilado desde el propio agente (API + UI en un único
   * puerto). Activo por defecto; en desarrollo (Vite en :5173) se desactiva con
   * `SERVE_WEB=false`. La ruta por defecto asume cwd = `apps/agent`.
   */
  web: {
    serve: process.env.SERVE_WEB !== 'false',
    distPath: process.env.WEB_DIST_PATH ?? resolve('../web/dist'),
  },

  /**
   * WebAuthn / passkey (2FA opcional, US-50). `rpID` es el dominio (sin protocolo)
   * desde el que se accede a la app; `origin` la URL completa. Deben coincidir con
   * el origen real del navegador o el navegador rechazará la passkey. Ver
   * `docs/webauthn-setup.md`.
   */
  webauthn: {
    rpName: process.env.WEBAUTHN_RP_NAME ?? 'KrakenOS',
    rpID: process.env.WEBAUTHN_RP_ID ?? 'localhost',
    origin: process.env.WEBAUTHN_ORIGIN ?? 'http://localhost:5173',
  },

  /** Config TLS (`{ key, cert }`) o `null` si el agente corre en HTTP. */
  https,

  /**
   * `trustProxy` de Fastify (US-76, F2). Configúralo si el agente corre tras un
   * proxy inverso (nginx) para que `req.ip` —usado en auditoría y rate limit—
   * refleje la IP real del cliente vía `X-Forwarded-For`. En vez de un booleano,
   * acepta un **nº de hops** (`TRUST_PROXY=1`) o una **lista de IPs/CIDRs** de
   * proxies de confianza (`TRUST_PROXY=10.0.0.1,10.0.0.0/8`). `true` (confiar en
   * cualquiera) sigue admitido pero se desaconseja (ver `trustProxyWarnings`).
   */
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),

  /** ¿Hay algún proxy de confianza configurado delante del agente? */
  behindProxy: parseTrustProxy(process.env.TRUST_PROXY) !== false,

  /** Cabeceras de seguridad servidas en todas las respuestas. */
  security: {
    /** CSP servida en cada respuesta; `CONTENT_SECURITY_POLICY` la sobreescribe entera. */
    csp: process.env.CONTENT_SECURITY_POLICY || undefined,
    /** HSTS: por defecto ligado a TLS; `HSTS_ENABLED` lo fuerza on/off (tras proxy HTTPS). */
    hsts: process.env.HSTS_ENABLED ? process.env.HSTS_ENABLED === 'true' : httpsEnabled,
  },
} as const;
