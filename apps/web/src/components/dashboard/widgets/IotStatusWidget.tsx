import type { IotDevice } from '@krakenos/types';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusDot } from '@/components/ui/status-dot';
import { api } from '@/lib/api';

interface BackendSummary {
  name: string;
  total: number;
  online: number;
}

/** Etiqueta legible por prefijo de backend (composite usa `<backend>:<id>`). */
const BACKEND_LABELS: Record<string, string> = {
  hue: 'Hue',
  govee: 'Govee',
  tuya: 'Tuya',
  zigbee: 'Zigbee',
  matter: 'Matter',
};

function summarize(devices: IotDevice[]): BackendSummary[] {
  const groups = new Map<string, IotDevice[]>();
  for (const d of devices) {
    // Con varios backends (composite) el id viene como `<backend>:<id>`.
    const key = d.id.includes(':') ? d.id.slice(0, d.id.indexOf(':')) : 'iot';
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(d);
  }
  return [...groups.entries()].map(([key, list]) => ({
    name: key === 'iot' ? 'IoT' : (BACKEND_LABELS[key] ?? key),
    total: list.length,
    online: list.filter((d) => d.reachable).length,
  }));
}

/** Estado de los backends IoT activos (Hue/Govee/Tuya…) con conteos. */
export function IotStatusWidget() {
  const [devices, setDevices] = useState<IotDevice[] | null>(null);

  useEffect(() => {
    let active = true;
    api
      .get<IotDevice[]>('/iot/devices')
      .then((d) => active && setDevices(d))
      .catch(() => active && setDevices([]));
    return () => {
      active = false;
    };
  }, []);

  const backends = devices ? summarize(devices) : [];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>IoT</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {devices === null ? (
          <p className="py-4 text-center text-kr-sm text-kr-muted">Cargando…</p>
        ) : backends.length === 0 ? (
          <p className="py-4 text-center text-kr-sm text-kr-muted">Sin dispositivos IoT.</p>
        ) : (
          <>
            {backends.map((b) => (
              <div key={b.name} className="flex items-center justify-between text-kr-base">
                <span className="flex items-center gap-2">
                  <StatusDot status={b.online > 0 ? 'online' : 'offline'} />
                  <span className="text-kr-primary">{b.name}</span>
                </span>
                <span className="text-kr-secondary">
                  {b.online}/{b.total} online
                </span>
              </div>
            ))}
            <Link to="/iot" className="inline-block text-kr-sm text-kr-accent hover:underline">
              Controlar IoT →
            </Link>
          </>
        )}
      </CardContent>
    </Card>
  );
}
