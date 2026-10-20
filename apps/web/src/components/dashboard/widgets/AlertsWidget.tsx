import type { AuditLogEntry } from '@krakenos/types';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadingLine } from '@/components/ui/loading-line';
import { WidgetError } from '@/components/ui/widget-error';
import { api } from '@/lib/api';
import { etiquetaDeAccion } from '@/lib/audit-actions';
import { timeAgo } from '@/lib/format';
import { plural, useT } from '@/lib/i18n';
import { useAuthStore } from '@/store/auth.store';
import '@/lib/i18n/catalog/fragments/panel';

const SEEN_KEY = 'krakenos-alerts-seen';

/** Últimas 5 acciones del audit log, con badge de no leídas. */
export function AlertsWidget() {
  const t = useT();
  // `GET /audit` es solo admin. Un rol ya cargado que no lo es no pide nada (y el
  // dashboard ni siquiera le ofrece el widget); un rol aún sin cargar sí pide.
  const role = useAuthStore((s) => s.user?.role);
  const puedeLeer = role === undefined || role === 'admin';
  const [entries, setEntries] = useState<AuditLogEntry[] | null>(null);
  const [unread, setUnread] = useState(0);
  // US-234: un fallo se declara como fallo; nunca se degrada al estado vacío.
  const [failed, setFailed] = useState(false);
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    if (!puedeLeer) return;
    let active = true;
    api
      .getList<AuditLogEntry>('/audit?limit=5')
      .then((list) => {
        if (!active) return;
        setEntries(list);
        const lastSeen = localStorage.getItem(SEEN_KEY) ?? '';
        setUnread(list.filter((e) => e.createdAt > lastSeen).length);
      })
      .catch(() => {
        if (!active) return;
        // Sin rama para el 403: quien no puede leer el audit no llega aquí, y a un
        // admin un 403 sí es un fallo real. Nunca se pinta como «sin alertas».
        setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [intento, puedeLeer]);

  const markSeen = () => {
    if (entries && entries[0]) localStorage.setItem(SEEN_KEY, entries[0].createdAt);
    setUnread(0);
  };

  if (!puedeLeer) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle>{t('widget.alerts.title')}</CardTitle>
        {unread > 0 && (
          <button type="button" onClick={markSeen} aria-label={t('widget.alerts.markRead')}>
            <Badge variant="warning">
              {unread}{' '}
              {plural(unread, {
                one: t('widget.alerts.new.one'),
                other: t('widget.alerts.new.other'),
              })}
            </Badge>
          </button>
        )}
      </CardHeader>
      <CardContent>
        {failed && entries === null ? (
          <WidgetError
            message={t('widget.alerts.error')}
            onRetry={() => setIntento((n) => n + 1)}
          />
        ) : entries === null ? (
          <LoadingLine />
        ) : entries.length === 0 ? (
          <p className="py-4 text-center text-kr-sm text-kr-muted">{t('widget.alerts.empty')}</p>
        ) : (
          <ul className="space-y-2 text-kr-sm">
            {entries.slice(0, 5).map((e) => (
              <li key={e.id} className="flex justify-between gap-2">
                <span className="truncate text-kr-primary">{etiquetaDeAccion(e.action, t)}</span>
                <span className="shrink-0 text-kr-muted">{timeAgo(e.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
