import type { WifiNetworkInfo } from '@krakenos/types';
import { Link } from 'react-router';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadingLine } from '@/components/ui/loading-line';
import { StaleBadge } from '@/components/ui/stale-badge';
import { StatusDot } from '@/components/ui/status-dot';
import { WidgetError } from '@/components/ui/widget-error';
import { api } from '@/lib/api';
import { plural, useT } from '@/lib/i18n';
import { useLectura } from '@/lib/use-lectura';
import '@/lib/i18n/catalog/fragments/panel';

/** SSIDs activos y clientes conectados por red. */
export function WifiStatusWidget() {
  const t = useT();
  const lectura = useLectura(() => api.getList<WifiNetworkInfo>('/wifi/networks'), []);
  const networks = lectura.data;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>WiFi</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {networks === null && lectura.failed ? (
          <WidgetError message={t('widget.wifi.error')} onRetry={lectura.reintentar} />
        ) : networks === null ? (
          <LoadingLine />
        ) : networks.length === 0 ? (
          <p className="py-4 text-center text-kr-sm text-kr-muted">{t('widget.wifi.empty')}</p>
        ) : (
          <>
            {lectura.failed && <StaleBadge />}
            {networks.map((n) => (
              <div key={n.id} className="flex items-center justify-between text-kr-base">
                <span className="flex min-w-0 items-center gap-2">
                  <StatusDot status={n.enabled ? 'online' : 'offline'} />
                  <span className="truncate text-kr-primary">
                    {n.ssid || t('widget.wifi.hiddenSsid')}
                  </span>
                  {n.isGuest && (
                    <span className="text-kr-xs text-kr-muted">{t('widget.wifi.guestTag')}</span>
                  )}
                </span>
                <span className="shrink-0 text-kr-secondary">
                  {n.clientCount}{' '}
                  {plural(n.clientCount, {
                    one: t('widget.wifi.client.one'),
                    other: t('widget.wifi.client.other'),
                  })}
                </span>
              </div>
            ))}
            <Link to="/wifi" className="inline-block text-kr-sm text-kr-link hover:underline">
              {t('widget.wifi.manage')}
            </Link>
          </>
        )}
      </CardContent>
    </Card>
  );
}
