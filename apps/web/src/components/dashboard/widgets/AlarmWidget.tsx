import type { AlarmPhase, AlarmState } from '@krakenos/types';
import { Settings, ShieldAlert, ShieldCheck, ShieldOff } from 'lucide-react';
import { useEffect, useState } from 'react';
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
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/auth.store';
import { toast } from '@/store/toast.store';

const PHASE_LABEL: Record<AlarmPhase, string> = {
  disarmed: 'Desarmada',
  arming: 'Armándose…',
  armed: 'Armada',
  entry: 'Entrada — desarma',
  triggered: '¡ALARMA!',
};

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
  const role = useAuthStore((s) => s.user?.role);
  const canControl = canControlHome(role);
  const isAdmin = role === 'admin';
  const [state, setState] = useState<AlarmState | null>(null);
  const [loading, setLoading] = useState(true);
  // US-234: el `.catch(() => {})` dejaba `state` en null con `loading` ya false →
  // spinner infinito. Ahora el fallo se distingue de «todavía cargando».
  const [failed, setFailed] = useState(false);
  const [intento, setIntento] = useState(0);
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

  useEffect(() => {
    let active = true;
    const load = () =>
      getAlarmState()
        .then((s) => {
          if (!active) return;
          setState(s);
          setFailed(false);
        })
        .catch(() => active && setFailed(true))
        .finally(() => active && setLoading(false));
    void load();
    const id = setInterval(load, 3000); // refleja cuentas atrás y disparos
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [intento]);

  const arm = async (mode: 'away' | 'night') => {
    setBusy(true);
    try {
      setState(await armAlarm(mode));
    } catch (err) {
      toast.error(describeError(err, 'No se pudo armar la alarma'));
    } finally {
      setBusy(false);
    }
  };

  const disarm = async () => {
    setBusy(true);
    try {
      setState(await disarmAlarm(pinNeeded ? pin : undefined));
      setPinNeeded(false);
      setPin('');
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 401) {
        setPinNeeded(true); // el servidor exige PIN
        if (pinNeeded) toast.error('PIN incorrecto');
      } else {
        toast.error(describeError(err, 'No se pudo desarmar la alarma'));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <CardTitle>Alarma</CardTitle>
        {isAdmin && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSettingsOpen(true)}
            aria-label="Ajustes de alarma"
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
              setIntento((n) => n + 1);
            }}
          />
        ) : loading || !state ? (
          <LoadingLine />
        ) : (
          <>
            <div className={cn('flex items-center gap-2 text-lg font-semibold', PHASE_CLASS[state.phase])}>
              <PhaseIcon phase={state.phase} />
              <span>{PHASE_LABEL[state.phase]}</span>
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
                  {pinNeeded && (
                    <Input
                      type="password"
                      inputMode="numeric"
                      placeholder="PIN de desarme"
                      value={pin}
                      onChange={(e) => setPin(e.target.value)}
                      aria-label="PIN de desarme"
                    />
                  )}
                  <Button
                    variant="destructive"
                    className="w-full"
                    disabled={busy || (pinNeeded && pin.length === 0)}
                    onClick={() => void disarm()}
                  >
                    Desarmar
                  </Button>
                </div>
              )
            ) : (
              <p className="text-kr-xs text-kr-muted">Tu rol no permite armar o desarmar la alarma.</p>
            )}
          </>
        )}
      </CardContent>

      {settingsOpen && <AlarmSettingsSlideover onClose={() => setSettingsOpen(false)} />}
    </Card>
  );
}
