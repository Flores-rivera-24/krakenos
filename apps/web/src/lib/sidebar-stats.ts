import type { FirewallRule, IotDevice, SystemStats } from '@krakenos/types';
import { useCallback, useState } from 'react';
import { api } from '@/lib/api';
import { usePolling } from '@/lib/use-polling';

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
/**
 * Sondea `/health`, `/system/stats`, `/firewall/rules` e `/iot/devices` para
 * alimentar la barra lateral. Tolera errores (conserva los valores previos).
 *
 * **`enabled`** (US-239 / AUD3-27): la barra lateral es `hidden md:flex`, así que
 * en móvil no se pinta — y aun así este hook estaba sondeando **4 endpoints cada
 * 8 segundos** para datos que nadie veía. Ahora lo llama `AppSidebar`, que es
 * quien sabe si está en pantalla, en vez de `AppLayout`, que lo hacía siempre.
 * Además el sondeo se detiene con la pestaña oculta (ver `usePolling`).
 */
export function useSidebarStats(pollMs = 8000, enabled = true): SidebarStats {
  const [stats, setStats] = useState<SidebarStats>(EMPTY);

  const load = useCallback(async () => {
    const fetchHealth = (): Promise<HealthResponse | null> =>
      fetch('/health')
        .then((r) => (r.ok ? (r.json() as Promise<HealthResponse>) : null))
        .catch(() => null);

    const [health, system, firewall, iot] = await Promise.all([
      fetchHealth(),
      api.get<SystemStats>('/system/stats').catch(() => null),
      api.getList<FirewallRule>('/firewall/rules').catch(() => null),
      api.getList<IotDevice>('/iot/devices').catch(() => null),
    ]);
    setStats((prev) => ({
      driver: health?.driver ?? prev.driver,
      online: health ? health.status === 'ok' : false,
      uptimeSeconds: system?.uptimeSeconds ?? prev.uptimeSeconds,
      firewallActive: firewall ? firewall.filter((r) => r.enabled).length : prev.firewallActive,
      iotOffline: iot ? iot.filter((d) => !d.reachable).length : prev.iotOffline,
    }));
  }, []);

  usePolling(load, pollMs, { enabled });

  return stats;
}
