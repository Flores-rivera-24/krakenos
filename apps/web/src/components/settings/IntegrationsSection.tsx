import type { IotDevice } from '@krakenos/types';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StaleBadge } from '@/components/ui/stale-badge';
import { StatusDot } from '@/components/ui/status-dot';
import { WidgetError } from '@/components/ui/widget-error';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useLectura } from '@/lib/use-lectura';
import { TuyaManager } from './TuyaManager';
import '@/lib/i18n/catalog/fragments/ajustes';

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
  unknown = false,
  pending = false,
  children,
}: {
  title: string;
  stats: BackendStats;
  /** La lectura falló y no hay dato: no se sabe si está o no, y no se dice «No detectada». */
  unknown?: boolean;
  /** Aún no ha llegado la respuesta: ni «detectada», ni «no detectada», ni fallo. */
  pending?: boolean;
  children?: ReactNode;
}) {
  const t = useT();
  const active = stats.total > 0;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle>{title}</CardTitle>
        {!pending && (
          <StatusDot
            status={
              unknown ? 'warning' : active ? (stats.online > 0 ? 'online' : 'warning') : 'offline'
            }
          />
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-kr-sm text-kr-secondary" aria-busy={pending || undefined}>
          {pending
            ? null
            : unknown
              ? t('integrations.unknown')
              : active
                ? t('integrations.online', { online: stats.online, total: stats.total })
                : t('integrations.undetected')}
        </p>
        {children}
      </CardContent>
    </Card>
  );
}

interface Props {
  isAdmin: boolean;
}

export function IntegrationsSection({ isAdmin }: Props) {
  const t = useT();
  const [tuyaOpen, setTuyaOpen] = useState(false);
  const lectura = useLectura(() => api.getList<IotDevice>('/iot/devices'), []);
  const devices = lectura.data ?? [];
  // Sin dato y con fallo no se sabe qué hay: ni «No detectada» ni ofrecer re-vincular.
  const unknown = lectura.failed && lectura.data === null;
  // Mientras llega la primera respuesta, estado neutro.
  const pending = lectura.data === null && !lectura.failed;

  const hue = backendStats(devices, 'hue');
  const govee = backendStats(devices, 'govee');
  const tuya = backendStats(devices, 'tuya');
  const reachableTuya = new Set(
    devices
      .filter((d) => d.id.startsWith('tuya:') && d.reachable)
      .map((d) => d.id.slice('tuya:'.length)),
  );

  return (
    <div className="space-y-6">
      {lectura.failed &&
        (lectura.data === null ? (
          <WidgetError message={t('integrations.loadError')} onRetry={lectura.reintentar} />
        ) : (
          <StaleBadge />
        ))}
      <div className="grid gap-4 sm:grid-cols-2">
        <IntegrationCard title="Philips Hue" stats={hue} unknown={unknown} pending={pending}>
          {!unknown && !pending && hue.total === 0 && (
            <p className="text-kr-xs text-kr-muted">{t('integrations.hue.relink')}</p>
          )}
        </IntegrationCard>

        <IntegrationCard title="Govee" stats={govee} unknown={unknown} pending={pending}>
          {!unknown && !pending && govee.total === 0 && (
            <p className="text-kr-xs text-kr-muted">{t('integrations.govee.hint')}</p>
          )}
        </IntegrationCard>

        <IntegrationCard title="Tuya" stats={tuya} unknown={unknown} pending={pending}>
          {isAdmin && (
            <Button variant="outline" size="sm" onClick={() => setTuyaOpen((v) => !v)}>
              {tuyaOpen ? t('integrations.tuya.hide') : t('integrations.tuya.manage')}
            </Button>
          )}
        </IntegrationCard>

        {/* Las guías de cada integración viven en /connect, no en rutas de ficheros. */}
        <Link
          to="/connect"
          className={`${buttonVariants({ variant: 'outline' })} min-h-[120px] border-dashed`}
        >
          {t('integrations.connect')}
        </Link>
      </div>

      {tuyaOpen && isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>{t('integrations.tuya.bulbs')}</CardTitle>
          </CardHeader>
          <CardContent>
            <TuyaManager reachable={reachableTuya} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
