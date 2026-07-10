import type { ConnectivityTestResult, IotDevice } from '@krakenos/types';
import { Plus } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { StatusDot } from '@/components/ui/status-dot';
import { api } from '@/lib/api';
import { useT, type TranslationKey } from '@/lib/i18n';
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
  const t = useT();
  const active = stats.total > 0;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle>{title}</CardTitle>
        <StatusDot status={active ? (stats.online > 0 ? 'online' : 'warning') : 'offline'} />
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-kr-sm text-kr-secondary">
          {active
            ? t('settings.integrations.online', { online: stats.online, total: stats.total })
            : t('settings.integrations.notDetected')}
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

const DOCS: { name: string; doc: string; hintKey: TranslationKey }[] = [
  { name: 'Philips Hue', doc: 'docs/hue-setup.md', hintKey: 'settings.integrations.hueHint' },
  { name: 'Govee', doc: 'docs/govee-setup.md', hintKey: 'settings.integrations.goveeHint' },
  { name: 'Tuya', doc: 'docs/tuya-setup.md', hintKey: 'settings.integrations.tuyaHint' },
  { name: 'Cisco IOS', doc: 'docs/cisco-ios-setup.md', hintKey: 'settings.integrations.ciscoHint' },
];

export function IntegrationsSection({ driver, isAdmin }: Props) {
  const t = useT();
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
            <p className="text-kr-xs text-kr-muted">{t('settings.integrations.hueRelink')}</p>
          )}
        </IntegrationCard>

        <IntegrationCard title="Govee" stats={govee}>
          {govee.total === 0 && (
            <p className="text-kr-xs text-kr-muted">{t('settings.integrations.goveeHint')}</p>
          )}
        </IntegrationCard>

        <IntegrationCard title="Tuya" stats={tuya}>
          {isAdmin && (
            <Button variant="outline" size="sm" onClick={() => setTuyaOpen((v) => !v)}>
              {tuyaOpen
                ? t('settings.integrations.tuyaHide')
                : t('settings.integrations.tuyaManage')}
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
              <p className="text-kr-sm text-kr-secondary">
                {t('settings.integrations.driver', { driver })}
              </p>
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
                  {t('settings.integrations.testSsh')}
                </Button>
              )}
              {ciscoTest && (
                <p className="text-kr-xs text-kr-muted">
                  {ciscoTest.ok
                    ? t('settings.integrations.ciscoConnected', { latency: ciscoTest.latencyMs ?? 0 })
                    : ciscoTest.error}
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
          {t('settings.integrations.addIntegration')}
        </button>
      </div>

      {tuyaOpen && isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>{t('settings.integrations.tuyaBulbsTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            <TuyaManager reachable={reachableTuya} />
          </CardContent>
        </Card>
      )}

      {addOpen && (
        <Dialog open onClose={() => setAddOpen(false)} aria-labelledby="dialog-add-integration-title">
          <h3
            id="dialog-add-integration-title"
            className="text-kr-lg font-semibold text-kr-primary"
          >
            {t('settings.integrations.addIntegration')}
          </h3>
          <p className="mt-1 text-kr-sm text-kr-secondary">
            {t('settings.integrations.addDescription')}
          </p>
          <ul className="mt-4 space-y-3">
            {DOCS.map((d) => (
              <li key={d.name} className="rounded-md border border-kr p-3">
                <div className="text-kr-base text-kr-primary">{d.name}</div>
                <div className="text-kr-sm text-kr-secondary">{t(d.hintKey)}</div>
                <code className="text-kr-xs text-kr-muted">{d.doc}</code>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex justify-end">
            <Button variant="outline" size="sm" onClick={() => setAddOpen(false)}>
              {t('common.close')}
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
