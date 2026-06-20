import type { FirewallRule, IotDevice, SystemStats } from '@krakenos/types';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface HealthResponse {
  status: string;
  driver: string;
  uptime: number;
}

/** Datos en vivo para la zona inferior y los badges de la sidebar. */
export interface SidebarStats {
  /** Nombre del driver activo (`mock`, `openwrt`, …); `null` si no se pudo leer. */
  driver: string | null;
  /** `true` si `/health` respondió ok. */
  online: boolean;
  /** Uptime del servidor en segundos; `null` si no disponible. */
  uptimeSeconds: number | null;
  /** Nº de reglas de firewall activas. */
  firewallActive: number;
  /** Nº de dispositivos IoT no alcanzables. */
  iotOffline: number;
}

const EMPTY: SidebarStats = {
  driver: null,
  online: false,
  uptimeSeconds: null,
  firewallActive: 0,
  iotOffline: 0,
};

/**
 * Sondea `/health`, `/system/stats`, `/firewall/rules` e `/iot/devices`
 * para alimentar la sidebar. Tolera errores (devuelve valores previos).
 */
export function useSidebarStats(pollMs = 8000): SidebarStats {
  const [stats, setStats] = useState<SidebarStats>(EMPTY);

  useEffect(() => {
    let active = true;

    const fetchHealth = (): Promise<HealthResponse | null> =>
      fetch('/health')
        .then((r) => (r.ok ? (r.json() as Promise<HealthResponse>) : null))
        .catch(() => null);

    const load = async () => {
      const [health, system, firewall, iot] = await Promise.all([
        fetchHealth(),
        api.get<SystemStats>('/system/stats').catch(() => null),
        api.get<FirewallRule[]>('/firewall/rules').catch(() => null),
        api.get<IotDevice[]>('/iot/devices').catch(() => null),
      ]);
      if (!active) return;
      setStats((prev) => ({
        driver: health?.driver ?? prev.driver,
        online: health ? health.status === 'ok' : false,
        uptimeSeconds: system?.uptimeSeconds ?? prev.uptimeSeconds,
        firewallActive: firewall ? firewall.filter((r) => r.enabled).length : prev.firewallActive,
        iotOffline: iot ? iot.filter((d) => !d.reachable).length : prev.iotOffline,
      }));
    };

    void load();
    const id = setInterval(() => void load(), pollMs);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [pollMs]);

  return stats;
}
