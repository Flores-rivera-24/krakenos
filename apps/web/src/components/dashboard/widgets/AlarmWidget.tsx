import type { AlarmPhase, AlarmState } from '@krakenos/types';
import { Settings, ShieldAlert, ShieldCheck, ShieldOff } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { AlarmSettingsSlideover } from '@/components/dashboard/AlarmSettingsSlideover';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { LoadingLine } from '@/components/ui/loading-line';
import { WidgetError } from '@/components/ui/widget-error';
import { armAlarm, disarmAlarm, getAlarmState } from '@/lib/alarm';
import { ApiRequestError } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { canControlHome } from '@/lib/roles';
import { usePolling } from '@/lib/use-polling';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/auth.store';
import { toast } from '@/store/toast.store';
import { useT } from '@/lib/i18n';

/** Clave i18n de la etiqueta por fase (US-239). Se traduce al renderizar. */
const PHASE_LABEL_KEY = {
  disarmed: 'widget.alarm.phase.disarmed',
  arming: 'widget.alarm.phase.arming',
  armed: 'widget.alarm.phase.armed',
  entry: 'widget.alarm.phase.entry',
  triggered: 'widget.alarm.phase.triggered',
} as const satisfies Record<AlarmPhase, string>;

const PHASE_CLASS: Record<AlarmPhase, string> = {
  disarmed: 'text-kr-secondary',
  arming: 'text-warning',
  armed: 'text-success',
  entry: 'text-warning',
  triggered: 'text-danger',
};

function PhaseIcon({ phase }: { phase: AlarmPhase }) {
  if (phase === 'triggered' || phase === 'entry')
    return <ShieldAlert className="h-5 w-5" aria-hidden />;
  if (phase === 'armed' || phase === 'arming') return <ShieldCheck className="h-5 w-5" aria-hidden />;
  return <ShieldOff className="h-5 w-5" aria-hidden />;
}

/** localStorage: recuerda que el usuario ya vio el aviso «no es alarma certificada». */
const DISCLAIMER_KEY = 'krakenos.alarmDisclaimerAck';
function disclaimerAcked(): boolean {
  try {
    return localStorage.getItem(DISCLAIMER_KEY) === '1';
  } catch {
    return false;
  }
}
function ackDisclaimer(): void {
  try {
    localStorage.setItem(DISCLAIMER_KEY, '1');
  } catch {
    /* almacenamiento no disponible: se volverá a mostrar, sin más */
  }
}

/** Cuenta atrás en segundos hasta `endsAt`, o null. */
function useCountdown(endsAt: string | null): number | null {
  const [secs, setSecs] = useState<number | null>(null);
  useEffect(() => {
    if (!endsAt) {
      setSecs(null);
      return;
    }
    const tick = () => setSecs(Math.max(0, Math.round((Date.parse(endsAt) - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [endsAt]);
  return secs;
}

/**
 * Alarma del hogar (US-188): estado + armar (Fuera/Noche) + desarmar. El desarme
 * pide PIN solo si el servidor lo exige (se descubre por el 401). Armar/desarmar
 * requiere `home.control` (kid/guest no). Config (sirena/sensores/PIN) para admin.
 */
export function AlarmWidget() {
  const t = useT();
  const role = useAuthStore((s) => s.user?.role);
  const canControl = canControlHome(role);
  const isAdmin = role === 'admin';
  const [state, setState] = useState<AlarmState | null>(null);
  const [loading, setLoading] = useState(true);
  // US-234: el `.catch(() => {})` dejaba `state` en null con `loading` ya false →
  // spinner infinito. Ahora el fallo se distingue de «todavía cargando».
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pinNeeded, setPinNeeded] = useState(false);
  const [pin, setPin] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showDisclaimer, setShowDisclaimer] = useState(() => !disclaimerAcked());
  const countdown = useCountdown(state?.countdownEndsAt ?? null);

  const dismissDisclaimer = () => {
    ackDisclaimer();
    setShowDisclaimer(false);
  };

  // Refleja cuentas atrás y disparos. US-262: iba con un `setInterval` a pelo, así
  // que seguía preguntando cada 3 s con la pestaña **oculta** — el gasto que
  // US-239 (AUD3-27) fue a quitar, del que este widget se había quedado fuera.
  const load = useCallback(
    () =>
      getAlarmState()
        .then((s) => {
          setState(s);
          setFailed(false);
        })
        .catch(() => setFailed(true))
        .finally(() => setLoading(false)),
    [],
  );
  usePolling(load, 3000);

  const arm = async (mode: 'away' | 'night') => {
    setBusy(true);
    try {
      setState(await armAlarm(mode));
    } catch (err) {
      toast.error(describeError(err, t('widget.alarm.armFailed')));
    } finally {
      setBusy(false);
    }
  };

  const disarm = async () => {
    setBusy(true);
    try {
      // US-235: el PIN se manda si el servidor lo pide (`requiresPin`) o si un
      // 401 previo lo revelo; ya no hay que fallar una vez para descubrirlo.
      setState(await disarmAlarm(pin.length > 0 ? pin : undefined));
      setPinNeeded(false);
      setPin('');
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 401) {
        setPinNeeded(true); // el servidor exige PIN
        // US-235: antes el aviso solo salía en el SEGUNDO intento, porque el
        // primero servía para «descubrir» que hacía falta PIN. Ahora el campo ya
        // está ahí (`requiresPin`), así que un 401 con PIN escrito significa
        // exactamente una cosa y hay que decirla.
        if (pin.length > 0) toast.error(t('widget.alarm.badPin'));
      } else {
        toast.error(describeError(err, t('widget.alarm.disarmFailed')));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <CardTitle>{t('widget.alarm.title')}</CardTitle>
        {isAdmin && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSettingsOpen(true)}
            aria-label={t('widget.alarm.settings')}
          >
            <Settings className="h-4 w-4" aria-hidden />
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {failed && !state ? (
          <WidgetError
            what="el estado de la alarma"
            onRetry={() => {
              setLoading(true);
              void load();
            }}
          />
        ) : loading || !state ? (
          <LoadingLine />
        ) : (
          <>
            <div className={cn('flex items-center gap-2 text-lg font-semibold', PHASE_CLASS[state.phase])}>
              <PhaseIcon phase={state.phase} />
              <span>{t(PHASE_LABEL_KEY[state.phase])}</span>
              {countdown !== null && <span className="text-kr-sm font-normal">({countdown}s)</span>}
            </div>
            {state.triggeredBy && (state.phase === 'entry' || state.phase === 'triggered') && (
              <p className="text-kr-xs text-kr-muted">Disparada por {state.triggeredBy}</p>
            )}

            {canControl && showDisclaimer && (
              <Callout variant="warning" title="No sustituye una alarma certificada">
                <div className="space-y-2">
                  <p>
                    Sin batería de respaldo ni conexión de emergencia por red móvil: deja de funcionar
                    si se va la luz o se apaga el servidor. Es un aviso extra, no tu única protección.
                  </p>
                  <Button variant="outline" size="sm" onClick={dismissDisclaimer}>
                    Entendido
                  </Button>
                </div>
              </Callout>
            )}

            {canControl ? (
              state.phase === 'disarmed' ? (
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" disabled={busy} onClick={() => void arm('away')}>
                    Armar (Fuera)
                  </Button>
                  <Button variant="outline" disabled={busy} onClick={() => void arm('night')}>
                    Armar (Noche)
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  {(pinNeeded || state.requiresPin) && (
                    <Input
                      type="password"
                      inputMode="numeric"
                      placeholder={t('widget.alarm.pinLabel')}
                      value={pin}
                      onChange={(e) => setPin(e.target.value)}
                      aria-label={t('widget.alarm.pinLabel')}
                    />
                  )}
                  <Button
                    variant="destructive"
                    className="w-full"
                    disabled={busy || ((pinNeeded || state.requiresPin) && pin.length === 0)}
                    onClick={() => void disarm()}
                  >
                    Desarmar
                  </Button>
                </div>
              )
            ) : (
              <p className="text-kr-xs text-kr-muted">{t('widget.alarm.noPermission')}</p>
            )}
          </>
        )}
      </CardContent>

      {settingsOpen && <AlarmSettingsSlideover onClose={() => setSettingsOpen(false)} />}
    </Card>
  );
}
