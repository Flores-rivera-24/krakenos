import type { DnsFeed } from '@krakenos/types';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadingLine } from '@/components/ui/loading-line';
import { Switch } from '@/components/ui/switch';
import { api } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { toast } from '@/store/toast.store';

/**
 * Feeds de categoría / adlists (US-114): suscríbete a listas curadas de bloqueo
 * (publicidad, malware, rastreo). Solo `admin` togglea; el resolver (Pi-hole) las
 * gestiona por URL.
 */
export function DnsFeeds({ canEdit }: { canEdit: boolean }) {
  const [feeds, setFeeds] = useState<DnsFeed[] | null>(null);

  const load = async () => {
    try {
      setFeeds(await api.get<DnsFeed[]>('/dns/feeds'));
    } catch (err) {
      toast.error(describeError(err, 'No se pudieron cargar los feeds'));
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
      toast.error(describeError(err, 'No se pudo cambiar el feed'));
      await load();
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base text-foreground">Feeds de categoría</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-kr-sm text-kr-secondary">
          Suscríbete a listas curadas de bloqueo (publicidad, malware, rastreo). Requiere Pi-hole;
          el resolver las gestiona por URL.
        </p>
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
                  aria-label={`Activar ${f.name}`}
                />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
