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
import {
  createManagerHolder,
  disposeManager,
  stopManager,
  type ManagerHolder,
} from './manager-holder.js';

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
/** Espera máxima por dominio al apagar el agente (US-229). */
const STOP_TIMEOUT_MS = 5_000;

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
  /**
   * Reconstruye e intercambia en caliente el manager de `domain` desde la config
   * actual. Devuelve `fallback: true` si la config guardada no se pudo aplicar y
   * el manager vivo quedó construido desde `.env` (US-205 / AUD-09).
   */
  reconfigure(domain: IntegrationDomain): Promise<{ fallback: boolean }>;
  /**
   * Apaga **todos** los managers vivos (best-effort, en paralelo) al cerrar el
   * agente. Antes de US-229 el `onClose` solo apagaba las cámaras, así que un
   * reinicio dejaba abiertas la sesión SSH del router, la SNMP del switch y las
   * conexiones persistentes de IoT (AUD3-16).
   */
  stopAll(): Promise<void>;
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
  ): Promise<{ value: T; fallback: boolean }> {
    const rec = await effective(domain);
    if (!rec) return { value: build(null), fallback: false };
    try {
      return { value: build(rec), fallback: false };
    } catch (err) {
      app.log.warn(
        `[integrations] no se pudo aplicar la config guardada de ${domain} ` +
          `(${err instanceof Error ? err.message : String(err)}); se usa el fallback de .env`,
      );
      // fallback: la config guardada existe pero el manager vivo viene de .env (US-205).
      return { value: build(null), fallback: true };
    }
  }

  const driver = createManagerHolder<HardwareDriver>(
    (await tryBuild('driver', (r) => wrapDriverErrors(createDriver(resolveDriverConfig(r))))).value,
    disposeManager,
  );
  const vpn = createManagerHolder<VpnManager>(
    (await tryBuild('vpn', (r) => createVpnManager(resolveVpnConfig(r)))).value,
    disposeManager,
  );
  const initialIot = (await tryBuild('iot', (r) => createIotManager(resolveIotConfig(r)))).value;
  startIotManager(initialIot.manager, onIotError);
  const iot = createManagerHolder<IotManager>(initialIot.manager, disposeManager);
  const tuyaStore = initialIot.tuyaStore;
  const cameras = createManagerHolder<CameraManager>(
    (await tryBuild('cameras', (r) => createCameraManager(resolveCameraConfig(r)))).value,
    disposeManager,
  );
  const firewall = createManagerHolder<FirewallManager>(
    (await tryBuild('firewall', (r) => createFirewallManager(resolveFirewallConfig(r)))).value,
    disposeManager,
  );
  const vlan = createManagerHolder<VlanManager>(
    (await tryBuild('vlan', (r) => createVlanManager(resolveVlanConfig(r)))).value,
    disposeManager,
  );
  const qos = createManagerHolder<QosManager>(
    (await tryBuild('qos', (r) => createQosManager(resolveQosConfig(r)))).value,
    disposeManager,
  );
  const dns = createManagerHolder<DnsManager>(
    (await tryBuild('dns', (r) => createDnsManager(resolveDnsConfig(r)))).value,
    disposeManager,
  );

  async function reconfigure(domain: IntegrationDomain): Promise<{ fallback: boolean }> {
    switch (domain) {
      case 'driver': {
        const r = await tryBuild('driver', (rec) => wrapDriverErrors(createDriver(resolveDriverConfig(rec))));
        driver.swap(r.value);
        return { fallback: r.fallback };
      }
      case 'vpn': {
        const r = await tryBuild('vpn', (rec) => createVpnManager(resolveVpnConfig(rec)));
        vpn.swap(r.value);
        return { fallback: r.fallback };
      }
      case 'iot': {
        // Reinyecta el mismo tuyaStore para no duplicar la instancia (US-63).
        const r = await tryBuild('iot', (rec) => createIotManager(resolveIotConfig(rec), { tuyaStore }));
        startIotManager(r.value.manager, onIotError);
        iot.swap(r.value.manager);
        return { fallback: r.fallback };
      }
      case 'cameras': {
        const r = await tryBuild('cameras', (rec) => createCameraManager(resolveCameraConfig(rec)));
        cameras.swap(r.value);
        return { fallback: r.fallback };
      }
      case 'firewall': {
        const r = await tryBuild('firewall', (rec) => createFirewallManager(resolveFirewallConfig(rec)));
        firewall.swap(r.value);
        return { fallback: r.fallback };
      }
      case 'vlan': {
        const r = await tryBuild('vlan', (rec) => createVlanManager(resolveVlanConfig(rec)));
        vlan.swap(r.value);
        return { fallback: r.fallback };
      }
      case 'qos': {
        const r = await tryBuild('qos', (rec) => createQosManager(resolveQosConfig(rec)));
        qos.swap(r.value);
        return { fallback: r.fallback };
      }
      case 'dns': {
        const r = await tryBuild('dns', (rec) => createDnsManager(resolveDnsConfig(rec)));
        dns.swap(r.value);
        return { fallback: r.fallback };
      }
      default: {
        const exhaustive: never = domain;
        throw new Error(`Dominio de integración desconocido: ${String(exhaustive)}`);
      }
    }
  }

  async function stopAll(): Promise<void> {
    // En paralelo y best-effort (`stopManager` traga los fallos), y **con espera
    // acotada**: cerrar un socket ya muerto puede no volver nunca, y el apagado
    // del agente no debe depender de que el router conteste. El proceso está
    // saliendo: abandonar la limpieza de un dominio es mejor que colgarse.
    await Promise.all(
      [driver, vpn, iot, cameras, firewall, vlan, qos, dns].map(async (h) => {
        let timer: NodeJS.Timeout | undefined;
        const deadline = new Promise<void>((resolve) => {
          timer = setTimeout(resolve, STOP_TIMEOUT_MS);
          timer.unref();
        });
        await Promise.race([stopManager(h.current), deadline]);
        clearTimeout(timer);
      }),
    );
  }

  return { driver, vpn, iot, cameras, firewall, vlan, qos, dns, tuyaStore, reconfigure, stopAll };
}
