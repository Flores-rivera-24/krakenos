import type { DnsFeed } from '@krakenos/types';
import { WidgetError } from '@/components/ui/widget-error';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadingLine } from '@/components/ui/loading-line';
import { StaleBadge } from '@/components/ui/stale-badge';
import { Switch } from '@/components/ui/switch';
import { api } from '@/lib/api';
import { textoDeListaDns } from '@/lib/dns-feeds';
import { describeError } from '@/lib/errors';
import { useT } from '@/lib/i18n';
import { useLectura } from '@/lib/use-lectura';
import { toast } from '@/store/toast.store';
import '@/lib/i18n/catalog/fragments/dns';

/**
 * Listas por categoría / adlists (US-114): suscríbete a listas curadas de bloqueo
 * (publicidad, malware, rastreo). Solo `admin` togglea; el resolver (Pi-hole) las
 * gestiona por URL.
 */
export function DnsFeeds({ canEdit }: { canEdit: boolean }) {
  const t = useT();
  const lectura = useLectura(() => api.getList<DnsFeed>('/dns/feeds'), []);
  const feeds = lectura.data;

  const toggle = async (feed: DnsFeed, enabled: boolean) => {
    lectura.setData((cur) => (cur ?? []).map((f) => (f.id === feed.id ? { ...f, enabled } : f)));
    try {
      await api.patch<DnsFeed>(`/dns/feeds/${feed.id}`, { enabled });
    } catch (err) {
      toast.error(describeError(err, t('dns.feeds.toggleError')));
      lectura.reintentar();
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base text-foreground">{t('dns.feeds.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-kr-sm text-kr-secondary">{t('dns.feeds.hint')}</p>
        {feeds !== null && lectura.failed && <StaleBadge />}
        {feeds === null && lectura.failed ? (
          <WidgetError message={t('dns.feeds.loadError')} onRetry={lectura.reintentar} />
        ) : feeds === null ? (
          <LoadingLine />
        ) : (
          <ul className="space-y-2">
            {feeds.map((f) => {
              const texto = textoDeListaDns(f.id);
              // Un id que esta web no conoce se declara; no se pinta crudo.
              const name = texto ? t(texto.name) : t('dns.feeds.unknown', { id: f.id });
              return (
                <li
                  key={f.id}
                  className="flex items-center gap-3 rounded-md border border-kr bg-kr-elevated px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-kr-sm text-kr-primary">{name}</p>
                    {texto && <p className="text-kr-xs text-kr-muted">{t(texto.description)}</p>}
                  </div>
                  <Switch
                    checked={f.enabled}
                    disabled={!canEdit}
                    onCheckedChange={(v) => void toggle(f, v)}
                    aria-label={t('dns.feeds.enableAria', { name })}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
