import type { HomeMode, PresenceEvent, PresenceState } from '@krakenos/types';
import { HOME_MODES } from '@krakenos/types';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadingLine } from '@/components/ui/loading-line';
import { StatusDot } from '@/components/ui/status-dot';
import { describeError } from '@/lib/errors';
import { timeAgo } from '@/lib/format';
import {
  getPresence,
  getPresenceTimeline,
  MODE_GLYPHS,
  MODE_LABEL_KEYS,
  setHomeMode,
} from '@/lib/presence';
import { canControlHome } from '@/lib/roles';
import { getSocket } from '@/lib/socket';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/auth.store';
import { toast } from '@/store/toast.store';
import { useT } from '@/lib/i18n';

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
  const [changing, setChanging] = useState(false);

  useEffect(() => {
    let active = true;
    const load = () =>
      void Promise.all([
        getPresence().catch(() => null),
        getPresenceTimeline(5).catch(() => [] as PresenceEvent[]),
      ])
        .then(([s, eventos]) => {
          if (!active) return;
          // Defensivo: un payload inesperado no debe tumbar el dashboard entero.
          if (s && Array.isArray(s.people)) setState(s);
          setTimeline(Array.isArray(eventos) ? eventos : []);
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
  }, []);

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
          <p className="py-4 text-center text-kr-sm text-kr-muted">
            {t('widget.homeMode.loadError')}
          </p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2" role="group" aria-label={t('widget.homeMode.group')}>
              {HOME_MODES.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={state.mode === mode}
                  disabled={!canControl || changing}
                  onClick={() => void changeMode(mode)}
                  className={cn(
                    'flex min-h-[3.5rem] flex-col items-center justify-center gap-1 rounded-lg border text-kr-sm transition-colors disabled:cursor-default disabled:opacity-60',
                    state.mode === mode
                      ? 'border-kr-accent bg-kr-accent-faint text-kr-primary'
                      : 'border-kr bg-kr-elevated text-kr-secondary hover:text-kr-primary',
                  )}
                >
                  <span aria-hidden className="text-xl">
                    {MODE_GLYPHS[mode]}
                  </span>
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

            {timeline.length > 0 && (
              <div>
                <p className="mb-1 text-kr-xs font-medium uppercase tracking-wide text-kr-muted">
                  {t('presence.timeline')}
                </p>
                <ul className="space-y-1">
                  {timeline.map((e) => (
                    <li key={e.id} className="flex items-center gap-2 text-kr-xs text-kr-muted">
                      <span aria-hidden>{e.kind === 'arrived' ? '→🏠' : '🏠→'}</span>
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
