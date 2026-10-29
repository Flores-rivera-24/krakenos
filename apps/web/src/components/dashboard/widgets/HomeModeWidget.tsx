import type { HomeMode, PresenceEvent, PresenceState } from '@krakenos/types';
import { HOME_MODES } from '@krakenos/types';
import { LogIn, LogOut } from 'lucide-react';
import { createElement, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadingLine } from '@/components/ui/loading-line';
import { StaleBadge } from '@/components/ui/stale-badge';
import { StatusDot } from '@/components/ui/status-dot';
import { WidgetError } from '@/components/ui/widget-error';
import { describeError } from '@/lib/errors';
import { timeAgo } from '@/lib/format';
import {
  getPresence,
  getPresenceTimeline,
  MODE_ICONS,
  MODE_LABEL_KEYS,
  setHomeMode,
} from '@/lib/presence';
import { canControlHome } from '@/lib/roles';
import { getSocket } from '@/lib/socket';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/auth.store';
import { toast } from '@/store/toast.store';
import { useT } from '@/lib/i18n';
import '@/lib/i18n/catalog/fragments/panel';

/**
 * Modos del hogar + presencia (US-169): selector de modo (En casa / Fuera /
 * Noche) y quién está en casa según la señal WiFi de sus dispositivos. La lista
 * de personas y el timeline llegan ya acotados por rol desde el servidor.
 */
export function HomeModeWidget() {
  const t = useT();
  const canControl = useAuthStore((s) => canControlHome(s.user?.role));
  const [state, setState] = useState<PresenceState | null>(null);
  const [timeline, setTimeline] = useState<PresenceEvent[]>([]);
  const [loading, setLoading] = useState(true);
  // Un fallo conserva lo último bueno y lo marca; sin nada que conservar, se dice.
  const [stateFailed, setStateFailed] = useState(false);
  const [timelineFailed, setTimelineFailed] = useState(false);
  const [intento, setIntento] = useState(0);
  const [changing, setChanging] = useState(false);

  useEffect(() => {
    let active = true;
    const load = () =>
      void Promise.all([
        getPresence().then(
          (s) => (s && Array.isArray(s.people) ? s : null),
          () => null,
        ),
        getPresenceTimeline(5).then(
          (e) => (Array.isArray(e) ? e : null),
          () => null,
        ),
      ])
        .then(([s, eventos]) => {
          if (!active) return;
          // Defensivo: un payload inesperado cuenta como fallo, no tumba el dashboard.
          if (s) setState(s);
          setStateFailed(s === null);
          if (eventos) setTimeline(eventos);
          setTimelineFailed(eventos === null);
        })
        .finally(() => active && setLoading(false));

    load();
    // El socket solo trae el modo (la presencia es sensible): al cambiar algo,
    // se re-consulta la vista acotada por rol vía API.
    const socket = getSocket();
    const onUpdated = () => load();
    socket.on('presence:updated', onUpdated);
    return () => {
      active = false;
      socket.off('presence:updated', onUpdated);
    };
  }, [intento]);

  const changeMode = async (mode: HomeMode) => {
    if (!state || mode === state.mode) return;
    setChanging(true);
    try {
      setState(await setHomeMode(mode));
    } catch (err) {
      toast.error(describeError(err, t('widget.homeMode.failed')));
    } finally {
      setChanging(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>{t('widget.homeMode.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <LoadingLine />
        ) : state === null ? (
          <WidgetError
            message={t('widget.homeMode.loadError')}
            onRetry={() => {
              setLoading(true);
              setIntento((n) => n + 1);
            }}
          />
        ) : (
          <>
            {stateFailed && <StaleBadge />}
            <div
              className="grid grid-cols-3 gap-2"
              role="group"
              aria-label={t('widget.homeMode.group')}
            >
              {HOME_MODES.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={state.mode === mode}
                  disabled={!canControl || changing}
                  onClick={() => void changeMode(mode)}
                  className={cn(
                    'flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 break-words rounded-lg border text-kr-sm transition-colors disabled:cursor-default disabled:opacity-60',
                    state.mode === mode
                      ? 'border-kr-accent bg-kr-accent-faint text-kr-primary'
                      : 'border-kr bg-kr-elevated text-kr-secondary hover:text-kr-primary',
                  )}
                >
                  {createElement(MODE_ICONS[mode], { 'aria-hidden': true, className: 'h-5 w-5' })}
                  {t(MODE_LABEL_KEYS[mode])}
                </button>
              ))}
            </div>
            {state.modeSource === 'presence' && (
              <p className="text-kr-xs text-kr-muted">{t('presence.autoMode')}</p>
            )}

            {state.people.length > 0 && (
              <ul className="space-y-1">
                {state.people.map((p) => (
                  <li key={p.userId} className="flex items-center gap-2 text-kr-sm">
                    <StatusDot status={p.home ? 'online' : 'offline'} />
                    <span className="min-w-0 flex-1 truncate text-kr-primary">{p.displayName}</span>
                    <span className="shrink-0 text-kr-xs text-kr-muted">
                      {p.deviceCount === 0
                        ? t('presence.noDevice')
                        : p.home
                          ? t('presence.home')
                          : t('presence.away')}
                      {p.home && p.signal === 'stale' ? t('presence.weakSignal') : ''}
                      {p.since ? t('presence.since', { when: timeAgo(p.since) }) : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {timelineFailed && timeline.length === 0 && (
              <p className="text-kr-xs text-kr-muted">{t('widget.homeMode.timelineError')}</p>
            )}
            {timeline.length > 0 && (
              <div>
                <p className="mb-1 text-kr-xs font-medium text-kr-muted">
                  {t('presence.timeline')}
                </p>
                {timelineFailed && !stateFailed && <StaleBadge className="mb-1" />}
                <ul className="space-y-1">
                  {timeline.map((e) => (
                    <li key={e.id} className="flex items-center gap-2 text-kr-xs text-kr-muted">
                      {e.kind === 'arrived' ? (
                        <LogIn aria-hidden className="h-4 w-4 shrink-0" />
                      ) : (
                        <LogOut aria-hidden className="h-4 w-4 shrink-0" />
                      )}
                      <span className="min-w-0 flex-1 truncate">
                        {e.kind === 'arrived'
                          ? t('presence.arrived', { name: e.displayName })
                          : t('presence.left', { name: e.displayName })}
                      </span>
                      <time className="shrink-0">{timeAgo(e.at)}</time>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {state.people.every((p) => p.deviceCount === 0) && (
              <p className="text-kr-xs text-kr-muted">{t('presence.assignOwner')}</p>
            )}
            {state.people.some((p) => p.deviceCount > 0) && (
              <p className="text-kr-xs text-kr-muted">{t('presence.caveat')}</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
