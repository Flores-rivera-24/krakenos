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
  MODE_LABELS,
  setHomeMode,
} from '@/lib/presence';
import { canControlHome } from '@/lib/roles';
import { getSocket } from '@/lib/socket';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/auth.store';
import { toast } from '@/store/toast.store';

/**
 * Modos del hogar + presencia (US-169): selector de modo (En casa / Fuera /
 * Noche) y quién está en casa según la señal WiFi de sus dispositivos. La lista
 * de personas y el timeline llegan ya acotados por rol desde el servidor.
 */
export function HomeModeWidget() {
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
        .then(([s, t]) => {
          if (!active) return;
          // Defensivo: un payload inesperado no debe tumbar el dashboard entero.
          if (s && Array.isArray(s.people)) setState(s);
          setTimeline(Array.isArray(t) ? t : []);
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
      toast.error(describeError(err, 'No se pudo cambiar el modo'));
    } finally {
      setChanging(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>Modo del hogar</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <LoadingLine />
        ) : state === null ? (
          <p className="py-4 text-center text-kr-sm text-kr-muted">
            No se pudo cargar el estado del hogar.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2" role="group" aria-label="Modo del hogar">
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
                  {MODE_LABELS[mode]}
                </button>
              ))}
            </div>
            {state.modeSource === 'presence' && (
              <p className="text-kr-xs text-kr-muted">
                Modo puesto automáticamente por la presencia.
              </p>
            )}

            {state.people.length > 0 && (
              <ul className="space-y-1">
                {state.people.map((p) => (
                  <li key={p.userId} className="flex items-center gap-2 text-kr-sm">
                    <StatusDot status={p.home ? 'online' : 'offline'} />
                    <span className="min-w-0 flex-1 truncate text-kr-primary">{p.displayName}</span>
                    <span className="shrink-0 text-kr-xs text-kr-muted">
                      {p.deviceCount === 0
                        ? 'sin dispositivo asignado'
                        : p.home
                          ? 'en casa'
                          : 'fuera'}
                      {p.since ? ` · ${timeAgo(p.since)}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {timeline.length > 0 && (
              <div>
                <p className="mb-1 text-kr-xs font-medium uppercase tracking-wide text-kr-muted">
                  Llegadas y salidas
                </p>
                <ul className="space-y-1">
                  {timeline.map((e) => (
                    <li key={e.id} className="flex items-center gap-2 text-kr-xs text-kr-muted">
                      <span aria-hidden>{e.kind === 'arrived' ? '→🏠' : '🏠→'}</span>
                      <span className="min-w-0 flex-1 truncate">
                        {e.displayName} {e.kind === 'arrived' ? 'llegó' : 'salió'}
                      </span>
                      <time className="shrink-0">{timeAgo(e.at)}</time>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {state.people.every((p) => p.deviceCount === 0) && (
              <p className="text-kr-xs text-kr-muted">
                Asigna un dueño al móvil de cada persona (detalle del dispositivo en Inventario)
                para que la casa sepa quién está.
              </p>
            )}
            {state.people.some((p) => p.deviceCount > 0) && (
              <p className="text-kr-xs text-kr-muted">
                La presencia se basa en la señal WiFi: un móvil en reposo profundo puede soltarla y
                aparecer como «fuera» un rato. No confíes solo en esto para acciones críticas.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
