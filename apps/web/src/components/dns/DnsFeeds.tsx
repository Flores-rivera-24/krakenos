import type { DnsFeed } from '@krakenos/types';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadingLine } from '@/components/ui/loading-line';
import { Switch } from '@/components/ui/switch';
import { api } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { useT } from '@/lib/i18n';
import { toast } from '@/store/toast.store';

/**
 * Listas por categoría / adlists (US-114): suscríbete a listas curadas de bloqueo
 * (publicidad, malware, rastreo). Solo `admin` togglea; el resolver (Pi-hole) las
 * gestiona por URL.
 */
export function DnsFeeds({ canEdit }: { canEdit: boolean }) {
  const t = useT();
  const [feeds, setFeeds] = useState<DnsFeed[] | null>(null);

  const load = async () => {
    try {
      setFeeds(await api.getList<DnsFeed>('/dns/feeds'));
    } catch (err) {
      toast.error(describeError(err, t('dns.feeds.loadError')));
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const toggle = async (feed: DnsFeed, enabled: boolean) => {
    setFeeds((cur) => cur?.map((f) => (f.id === feed.id ? { ...f, enabled } : f)) ?? cur);
    try {
      await api.patch<DnsFeed>(`/dns/feeds/${feed.id}`, { enabled });
    } catch (err) {
      toast.error(describeError(err, t('dns.feeds.toggleError')));
      await load();
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base text-foreground">{t('dns.feeds.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-kr-sm text-kr-secondary">{t('dns.feeds.hint')}</p>
        {feeds == null ? (
          <LoadingLine />
        ) : (
          <ul className="space-y-2">
            {feeds.map((f) => (
              <li
                key={f.id}
                className="flex items-center gap-3 rounded-md border border-kr bg-kr-elevated px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-kr-sm text-kr-primary">{f.name}</p>
                  <p className="text-kr-xs text-kr-muted">{f.description}</p>
                </div>
                <Switch
                  checked={f.enabled}
                  disabled={!canEdit}
                  onCheckedChange={(v) => void toggle(f, v)}
                  aria-label={t('dns.feeds.enableAria', { name: f.name })}
                />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
