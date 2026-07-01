import type { FastifyInstance } from 'fastify';
import type {
  CameraManager,
  DnsManager,
  FirewallManager,
  HardwareDriver,
  IntegrationDomain,
  IotManager,
  QosManager,
  VlanManager,
  VpnManager,
} from '@krakenos/types';
import { createCameraManager } from '../cameras/index.js';
import { createDnsManager } from '../dns/index.js';
import { createDriver } from '../drivers/index.js';
import { wrapDriverErrors } from '../drivers/driver-error.js';
import { createFirewallManager } from '../firewall/index.js';
import { createIotManager, startIotManager } from '../iot/index.js';
import type { TuyaDeviceRecord } from '../iot/tuya.store.js';
import type { FileJsonStore } from '../store/json-store.js';
import { createQosManager } from '../qos/index.js';
import { createVlanManager } from '../vlan/index.js';
import { createVpnManager } from '../vpn/index.js';
import type { DomainRecord } from './factory-config.js';
import {
  resolveCameraConfig,
  resolveDnsConfig,
  resolveDriverConfig,
  resolveFirewallConfig,
  resolveIotConfig,
  resolveQosConfig,
  resolveVlanConfig,
  resolveVpnConfig,
} from './factory-config.js';
import type { IntegrationConfigStore } from './integration-config.store.js';
import { createManagerHolder, disposeManager, type ManagerHolder } from './manager-holder.js';

/**
 * Runtime de integraciones recargable (US-141).
 *
 * Instancia cada manager a partir de la config **efectiva** (DB si está guardada y
 * activa; si no, `.env`) y lo guarda en un {@link ManagerHolder}. Los módulos reciben
 * el `handle` de cada holder, así `reconfigure(domain)` reconstruye e intercambia la
 * instancia viva sin reiniciar el agente ni re-registrar rutas.
 *
 * Robustez: si construir un manager desde la config **guardada** falla (config
 * inválida o secreto ilegible tras perder la clave), se registra un aviso y se cae al
 * fallback de `.env` en vez de tumbar el arranque.
 */
export interface IntegrationRuntime {
  driver: ManagerHolder<HardwareDriver>;
  vpn: ManagerHolder<VpnManager>;
  iot: ManagerHolder<IotManager>;
  cameras: ManagerHolder<CameraManager>;
  firewall: ManagerHolder<FirewallManager>;
  vlan: ManagerHolder<VlanManager>;
  qos: ManagerHolder<QosManager>;
  dns: ManagerHolder<DnsManager>;
  /** Store de dispositivos Tuya, compartido con las rutas `/api/iot/tuya` (US-63). */
  tuyaStore?: FileJsonStore<TuyaDeviceRecord>;
  /** Reconstruye e intercambia en caliente el manager de `domain` desde la config actual. */
  reconfigure(domain: IntegrationDomain): Promise<void>;
}

export async function buildIntegrationRuntime(
  app: Pick<FastifyInstance, 'log'>,
  store: IntegrationConfigStore,
): Promise<IntegrationRuntime> {
  /** Config efectiva de un dominio: registro DB activo, o `null` (→ fallback a `.env`). */
  const effective = async (domain: IntegrationDomain): Promise<DomainRecord | null> => {
    const rec = await store.getDecrypted(domain);
    return rec && rec.enabled ? { kind: rec.kind, values: rec.values } : null;
  };
  const onIotError = (msg: string): void =>
    app.log.error(`[iot] no se pudo arrancar la integración: ${msg}`);

  /**
   * Construye un manager desde la config efectiva de `domain`. Si la config **guardada**
   * hace fallar la construcción, avisa y reintenta con `.env` (record `null`).
   */
  async function tryBuild<T>(
    domain: IntegrationDomain,
    build: (rec: DomainRecord | null) => T,
  ): Promise<T> {
    const rec = await effective(domain);
    if (!rec) return build(null);
    try {
      return build(rec);
    } catch (err) {
      app.log.warn(
        `[integrations] no se pudo aplicar la config guardada de ${domain} ` +
          `(${err instanceof Error ? err.message : String(err)}); se usa el fallback de .env`,
      );
      return build(null);
    }
  }

  const driver = createManagerHolder<HardwareDriver>(
    await tryBuild('driver', (r) => wrapDriverErrors(createDriver(resolveDriverConfig(r)))),
    disposeManager,
  );
  const vpn = createManagerHolder<VpnManager>(
    await tryBuild('vpn', (r) => createVpnManager(resolveVpnConfig(r))),
    disposeManager,
  );
  const initialIot = await tryBuild('iot', (r) => createIotManager(resolveIotConfig(r)));
  startIotManager(initialIot.manager, onIotError);
  const iot = createManagerHolder<IotManager>(initialIot.manager, disposeManager);
  const tuyaStore = initialIot.tuyaStore;
  const cameras = createManagerHolder<CameraManager>(
    await tryBuild('cameras', (r) => createCameraManager(resolveCameraConfig(r))),
    disposeManager,
  );
  const firewall = createManagerHolder<FirewallManager>(
    await tryBuild('firewall', (r) => createFirewallManager(resolveFirewallConfig(r))),
    disposeManager,
  );
  const vlan = createManagerHolder<VlanManager>(
    await tryBuild('vlan', (r) => createVlanManager(resolveVlanConfig(r))),
    disposeManager,
  );
  const qos = createManagerHolder<QosManager>(
    await tryBuild('qos', (r) => createQosManager(resolveQosConfig(r))),
    disposeManager,
  );
  const dns = createManagerHolder<DnsManager>(
    await tryBuild('dns', (r) => createDnsManager(resolveDnsConfig(r))),
    disposeManager,
  );

  async function reconfigure(domain: IntegrationDomain): Promise<void> {
    switch (domain) {
      case 'driver':
        driver.swap(await tryBuild('driver', (r) => wrapDriverErrors(createDriver(resolveDriverConfig(r)))));
        break;
      case 'vpn':
        vpn.swap(await tryBuild('vpn', (r) => createVpnManager(resolveVpnConfig(r))));
        break;
      case 'iot': {
        // Reinyecta el mismo tuyaStore para no duplicar la instancia (US-63).
        const bundle = await tryBuild('iot', (r) => createIotManager(resolveIotConfig(r), { tuyaStore }));
        startIotManager(bundle.manager, onIotError);
        iot.swap(bundle.manager);
        break;
      }
      case 'cameras':
        cameras.swap(await tryBuild('cameras', (r) => createCameraManager(resolveCameraConfig(r))));
        break;
      case 'firewall':
        firewall.swap(await tryBuild('firewall', (r) => createFirewallManager(resolveFirewallConfig(r))));
        break;
      case 'vlan':
        vlan.swap(await tryBuild('vlan', (r) => createVlanManager(resolveVlanConfig(r))));
        break;
      case 'qos':
        qos.swap(await tryBuild('qos', (r) => createQosManager(resolveQosConfig(r))));
        break;
      case 'dns':
        dns.swap(await tryBuild('dns', (r) => createDnsManager(resolveDnsConfig(r))));
        break;
      default: {
        const exhaustive: never = domain;
        throw new Error(`Dominio de integración desconocido: ${String(exhaustive)}`);
      }
    }
  }

  return { driver, vpn, iot, cameras, firewall, vlan, qos, dns, tuyaStore, reconfigure };
}
