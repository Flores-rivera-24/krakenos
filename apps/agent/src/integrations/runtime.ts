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

  const driver = createManagerHolder<HardwareDriver>(
    wrapDriverErrors(createDriver(resolveDriverConfig(await effective('driver')))),
    disposeManager,
  );
  const vpn = createManagerHolder<VpnManager>(
    createVpnManager(resolveVpnConfig(await effective('vpn'))),
    disposeManager,
  );
  const initialIot = createIotManager(resolveIotConfig(await effective('iot')));
  startIotManager(initialIot.manager, onIotError);
  const iot = createManagerHolder<IotManager>(initialIot.manager, disposeManager);
  const tuyaStore = initialIot.tuyaStore;
  const cameras = createManagerHolder<CameraManager>(
    createCameraManager(resolveCameraConfig(await effective('cameras'))),
    disposeManager,
  );
  const firewall = createManagerHolder<FirewallManager>(
    createFirewallManager(resolveFirewallConfig(await effective('firewall'))),
    disposeManager,
  );
  const vlan = createManagerHolder<VlanManager>(
    createVlanManager(resolveVlanConfig(await effective('vlan'))),
    disposeManager,
  );
  const qos = createManagerHolder<QosManager>(
    createQosManager(resolveQosConfig(await effective('qos'))),
    disposeManager,
  );
  const dns = createManagerHolder<DnsManager>(
    createDnsManager(resolveDnsConfig(await effective('dns'))),
    disposeManager,
  );

  async function reconfigure(domain: IntegrationDomain): Promise<void> {
    const rec = await effective(domain);
    switch (domain) {
      case 'driver':
        driver.swap(wrapDriverErrors(createDriver(resolveDriverConfig(rec))));
        break;
      case 'vpn':
        vpn.swap(createVpnManager(resolveVpnConfig(rec)));
        break;
      case 'iot': {
        // Reinyecta el mismo tuyaStore para no duplicar la instancia (US-63).
        const bundle = createIotManager(resolveIotConfig(rec), { tuyaStore });
        startIotManager(bundle.manager, onIotError);
        iot.swap(bundle.manager);
        break;
      }
      case 'cameras':
        cameras.swap(createCameraManager(resolveCameraConfig(rec)));
        break;
      case 'firewall':
        firewall.swap(createFirewallManager(resolveFirewallConfig(rec)));
        break;
      case 'vlan':
        vlan.swap(createVlanManager(resolveVlanConfig(rec)));
        break;
      case 'qos':
        qos.swap(createQosManager(resolveQosConfig(rec)));
        break;
      case 'dns':
        dns.swap(createDnsManager(resolveDnsConfig(rec)));
        break;
      default: {
        const exhaustive: never = domain;
        throw new Error(`Dominio de integración desconocido: ${String(exhaustive)}`);
      }
    }
  }

  return { driver, vpn, iot, cameras, firewall, vlan, qos, dns, tuyaStore, reconfigure };
}
