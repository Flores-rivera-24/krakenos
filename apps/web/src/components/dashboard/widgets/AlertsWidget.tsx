import type { AuditLogEntry } from '@krakenos/types';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadingLine } from '@/components/ui/loading-line';
import { WidgetError } from '@/components/ui/widget-error';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/format';

const SEEN_KEY = 'krakenos-alerts-seen';

/** Últimas 5 acciones del audit log, con badge de no leídas. */
export function AlertsWidget() {
  const [entries, setEntries] = useState<AuditLogEntry[] | null>(null);
  const [unread, setUnread] = useState(0);
  // US-234: el `catch` de abajo pinta el estado vacío para un viewer sin permiso
  // (legítimo) pero también para un agente caído (mentira). Se distinguen.
  const [failed, setFailed] = useState(false);
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    let active = true;
    api
      .get<AuditLogEntry[]>('/audit?limit=5')
      .then((list) => {
        if (!active) return;
        setEntries(list);
        const lastSeen = localStorage.getItem(SEEN_KEY) ?? '';
        setUnread(list.filter((e) => e.createdAt > lastSeen).length);
      })
      .catch((err: unknown) => {
        if (!active) return;
        // 403 = un viewer no puede leer el audit: eso NO es un fallo, es su rol.
        const status = (err as { status?: number } | null)?.status;
        if (status === 403) setEntries([]);
        else setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [intento]);

  const markSeen = () => {
    if (entries && entries[0]) localStorage.setItem(SEEN_KEY, entries[0].createdAt);
    setUnread(0);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle>Alertas recientes</CardTitle>
        {unread > 0 && (
          <button type="button" onClick={markSeen} aria-label="Marcar como leídas">
            <Badge variant="warning">
              {unread} {unread === 1 ? 'nueva' : 'nuevas'}
            </Badge>
          </button>
        )}
      </CardHeader>
      <CardContent>
        {failed && entries === null ? (
          <WidgetError what="la actividad reciente" onRetry={() => setIntento((n) => n + 1)} />
        ) : entries === null ? (
          <LoadingLine />
        ) : entries.length === 0 ? (
          <p className="py-4 text-center text-kr-sm text-kr-muted">Sin actividad registrada.</p>
        ) : (
          <ul className="space-y-2 text-kr-sm">
            {entries.slice(0, 5).map((e) => (
              <li key={e.id} className="flex justify-between gap-2">
                <span className="truncate text-kr-primary">{e.action}</span>
                <span className="shrink-0 text-kr-muted">{timeAgo(e.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
