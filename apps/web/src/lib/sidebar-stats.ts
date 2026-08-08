import { useCallback, useState } from 'react';
import { useFirewallRules, useIotDevices, useSystemStats } from '@/lib/resources';
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
  // US-262: tres de las cuatro lecturas las comparte con el dashboard
  // (`/system/stats` con `SystemWidget`, `/iot/devices` con `IotStatusWidget` y
  // `QuickActionsWidget`). Al pedirlas por su cuenta, abrir el dashboard con la
  // barra lateral en pantalla pedía `/iot/devices` **tres** veces en el mismo
  // tick. Ahora comparten caché y una sola petición sirve a los tres.
  const system = useSystemStats({ enabled, pollMs });
  const firewall = useFirewallRules({ enabled, pollMs });
  const iot = useIotDevices({ enabled, pollMs });

  // `/health` se queda fuera del caché compartido a propósito: no es `/api`, no
  // lleva sesión y es la sonda que dice si el agente está vivo. Cachearla sería
  // arriesgarse a declarar «en línea» a un agente que ya no responde.
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthOk, setHealthOk] = useState(false);

  const leerHealth = useCallback(async () => {
    const r = await fetch('/health')
      .then((res) => (res.ok ? (res.json() as Promise<HealthResponse>) : null))
      .catch(() => null);
    setHealth((prev) => r ?? prev);
    setHealthOk(r !== null && r.status === 'ok');
  }, []);

  usePolling(leerHealth, pollMs, { enabled });

  return {
    driver: health?.driver ?? null,
    online: healthOk,
    // Se conserva el último valor conocido ante un fallo, igual que antes: un
    // corte de un ciclo no debe poner los badges a cero, que se leería como
    // «no tienes reglas» en vez de «no he podido preguntar».
    uptimeSeconds: system.data?.uptimeSeconds ?? null,
    firewallActive: firewall.data ? firewall.data.filter((r) => r.enabled).length : 0,
    iotOffline: iot.data ? iot.data.filter((d) => !d.reachable).length : 0,
  };
}
