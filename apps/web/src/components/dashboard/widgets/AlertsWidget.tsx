import type { AuditLogEntry } from '@krakenos/types';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/format';

const SEEN_KEY = 'krakenos-alerts-seen';

/** Últimas 5 acciones del audit log, con badge de no leídas. */
export function AlertsWidget() {
  const [entries, setEntries] = useState<AuditLogEntry[] | null>(null);
  const [unread, setUnread] = useState(0);

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
      .catch(() => active && setEntries([])); // p. ej. un viewer no puede leer el audit
    return () => {
      active = false;
    };
  }, []);

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
            <Badge variant="warning">{unread} nuevas</Badge>
          </button>
        )}
      </CardHeader>
      <CardContent>
        {entries === null ? (
          <p className="py-4 text-center text-kr-sm text-kr-muted">Cargando…</p>
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
