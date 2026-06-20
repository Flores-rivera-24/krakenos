import type { ConnectivityTestResult, IotDevice } from '@krakenos/types';
import { Plus } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { StatusDot } from '@/components/ui/status-dot';
import { api } from '@/lib/api';
import { TuyaManager } from './TuyaManager';

interface BackendStats {
  total: number;
  online: number;
}

function backendStats(devices: IotDevice[], prefix: string): BackendStats {
  const list = devices.filter((d) => d.id.startsWith(`${prefix}:`));
  return { total: list.length, online: list.filter((d) => d.reachable).length };
}

function IntegrationCard({
  title,
  stats,
  children,
}: {
  title: string;
  stats: BackendStats;
  children?: ReactNode;
}) {
  const active = stats.total > 0;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle>{title}</CardTitle>
        <StatusDot status={active ? (stats.online > 0 ? 'online' : 'warning') : 'offline'} />
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-kr-sm text-kr-secondary">
          {active ? `${stats.online}/${stats.total} en línea` : 'No detectada'}
        </p>
        {children}
      </CardContent>
    </Card>
  );
}

interface Props {
  driver: string;
  isAdmin: boolean;
}

const DOCS: { name: string; doc: string; hint: string }[] = [
  { name: 'Philips Hue', doc: 'docs/hue-setup.md', hint: 'Pulsa el botón del bridge y configura HUE_*.' },
  { name: 'Govee', doc: 'docs/govee-setup.md', hint: 'Activa "LAN Control" en la app Govee.' },
  { name: 'Tuya', doc: 'docs/tuya-setup.md', hint: 'Registra cada foco con su deviceId/localKey.' },
  { name: 'Cisco IOS', doc: 'docs/cisco-ios-setup.md', hint: 'Habilita SSH y configura DRIVER_KIND=cisco-ios.' },
];

export function IntegrationsSection({ driver, isAdmin }: Props) {
  const [devices, setDevices] = useState<IotDevice[]>([]);
  const [tuyaOpen, setTuyaOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [ciscoTest, setCiscoTest] = useState<ConnectivityTestResult | null>(null);

  useEffect(() => {
    let active = true;
    api
      .get<IotDevice[]>('/iot/devices')
      .then((d) => active && setDevices(d))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const hue = backendStats(devices, 'hue');
  const govee = backendStats(devices, 'govee');
  const tuya = backendStats(devices, 'tuya');
  const reachableTuya = new Set(
    devices.filter((d) => d.id.startsWith('tuya:') && d.reachable).map((d) => d.id.slice('tuya:'.length)),
  );
  const isCisco = driver === 'cisco-ios' || driver === 'cisco-netconf';

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <IntegrationCard title="Philips Hue" stats={hue}>
          {hue.total === 0 && (
            <p className="text-kr-xs text-kr-muted">Pulsa el botón del bridge para re-vincular.</p>
          )}
        </IntegrationCard>

        <IntegrationCard title="Govee" stats={govee}>
          {govee.total === 0 && (
            <p className="text-kr-xs text-kr-muted">Activa "LAN Control" en la app Govee.</p>
          )}
        </IntegrationCard>

        <IntegrationCard title="Tuya" stats={tuya}>
          {isAdmin && (
            <Button variant="outline" size="sm" onClick={() => setTuyaOpen((v) => !v)}>
              {tuyaOpen ? 'Ocultar focos' : 'Gestionar focos'}
            </Button>
          )}
        </IntegrationCard>

        {isCisco && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle>Cisco</CardTitle>
              <StatusDot status={ciscoTest ? (ciscoTest.ok ? 'online' : 'danger') : 'warning'} />
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-kr-sm text-kr-secondary">Driver: {driver}</p>
              {isAdmin && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    void api
                      .post<ConnectivityTestResult>('/system/connectivity-test')
                      .then(setCiscoTest)
                  }
                >
                  Probar conexión SSH
                </Button>
              )}
              {ciscoTest && (
                <p className="text-kr-xs text-kr-muted">
                  {ciscoTest.ok ? `Conectado · ${ciscoTest.latencyMs} ms` : ciscoTest.error}
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Añadir integración */}
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="flex min-h-[120px] items-center justify-center gap-2 rounded-xl border border-dashed border-kr text-kr-secondary hover:bg-kr-elevated hover:text-kr-primary"
        >
          <Plus className="h-5 w-5" />
          Añadir integración
        </button>
      </div>

      {tuyaOpen && isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>Focos Tuya</CardTitle>
          </CardHeader>
          <CardContent>
            <TuyaManager reachable={reachableTuya} />
          </CardContent>
        </Card>
      )}

      {addOpen && (
        <Dialog open onClose={() => setAddOpen(false)}>
          <h3 className="text-kr-lg font-semibold text-kr-primary">Añadir integración</h3>
          <p className="mt-1 text-kr-sm text-kr-secondary">
            Configura cada integración con su variable de entorno y consulta su guía en `docs/`.
          </p>
          <ul className="mt-4 space-y-3">
            {DOCS.map((d) => (
              <li key={d.name} className="rounded-md border border-kr p-3">
                <div className="text-kr-base text-kr-primary">{d.name}</div>
                <div className="text-kr-sm text-kr-secondary">{d.hint}</div>
                <code className="text-kr-xs text-kr-muted">{d.doc}</code>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex justify-end">
            <Button variant="outline" size="sm" onClick={() => setAddOpen(false)}>
              Cerrar
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
