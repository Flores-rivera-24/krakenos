import type { IntegrationDomain, IntegrationTestResult } from '@krakenos/types';
import { createCameraManager } from '../cameras/index.js';
import { createDnsManager } from '../dns/index.js';
import { createDriver } from '../drivers/index.js';
import { wrapDriverErrors } from '../drivers/driver-error.js';
import { createFirewallManager } from '../firewall/index.js';
import { createIotManager } from '../iot/index.js';
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
import { disposeManager } from './manager-holder.js';

/** Tiempo máximo de una prueba de conexión antes de darla por fallida. */
const PROBE_TIMEOUT_MS = 8000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('el equipo no respondió a tiempo (timeout)')),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

/**
 * Prueba una integración (US-142) construyendo un manager **transitorio** con la
 * config propuesta (sin persistir) y haciendo una lectura ligera. Devuelve un
 * resultado en lenguaje llano. El manager transitorio se limpia (dispose) al terminar.
 * Con `kind: 'mock'` la prueba siempre pasa (útil para el modo demostración).
 */
export async function testConnection(
  domain: IntegrationDomain,
  record: DomainRecord,
): Promise<IntegrationTestResult> {
  try {
    return await withTimeout(probe(domain, record), PROBE_TIMEOUT_MS);
  } catch (err) {
    return { ok: false, message: `No se pudo conectar: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function probe(domain: IntegrationDomain, record: DomainRecord): Promise<IntegrationTestResult> {
  switch (domain) {
    case 'driver': {
      const mgr = wrapDriverErrors(createDriver(resolveDriverConfig(record)));
      try {
        const ok = await mgr.healthcheck();
        return ok
          ? { ok: true, message: 'Conexión correcta con el equipo de red.' }
          : {
              ok: false,
              message: 'El equipo respondió pero el chequeo de estado falló. Revisa las credenciales.',
            };
      } finally {
        disposeManager(mgr);
      }
    }
    case 'vpn': {
      const mgr = createVpnManager(resolveVpnConfig(record));
      try {
        await mgr.getStatus();
        return { ok: true, message: 'WireGuard responde correctamente.' };
      } finally {
        disposeManager(mgr);
      }
    }
    case 'iot': {
      const { manager } = createIotManager(resolveIotConfig(record));
      try {
        const devices = await manager.listDevices();
        return {
          ok: true,
          message: `Conectado. ${devices.length} dispositivo(s) detectado(s).`,
          details: { dispositivos: devices.length },
        };
      } finally {
        disposeManager(manager);
      }
    }
    case 'cameras': {
      const mgr = createCameraManager(resolveCameraConfig(record));
      try {
        const cams = await mgr.listCameras();
        return { ok: true, message: `Conectado. ${cams.length} cámara(s).`, details: { camaras: cams.length } };
      } finally {
        disposeManager(mgr);
      }
    }
    case 'firewall': {
      const mgr = createFirewallManager(resolveFirewallConfig(record));
      try {
        const rules = await mgr.listRules();
        return { ok: true, message: `Cortafuegos operativo. ${rules.length} regla(s).`, details: { reglas: rules.length } };
      } finally {
        disposeManager(mgr);
      }
    }
    case 'vlan': {
      const mgr = createVlanManager(resolveVlanConfig(record));
      try {
        const vlans = await mgr.listVlans();
        return { ok: true, message: `Conectado. ${vlans.length} VLAN(s).`, details: { vlans: vlans.length } };
      } finally {
        disposeManager(mgr);
      }
    }
    case 'qos': {
      const mgr = createQosManager(resolveQosConfig(record));
      try {
        const rules = await mgr.listRules();
        return { ok: true, message: `QoS operativo. ${rules.length} regla(s).`, details: { reglas: rules.length } };
      } finally {
        disposeManager(mgr);
      }
    }
    case 'dns': {
      const mgr = createDnsManager(resolveDnsConfig(record));
      try {
        await mgr.getStats();
        return { ok: true, message: 'El servidor DNS responde correctamente.' };
      } finally {
        disposeManager(mgr);
      }
    }
    default: {
      const exhaustive: never = domain;
      throw new Error(`Dominio de integración desconocido: ${String(exhaustive)}`);
    }
  }
}
