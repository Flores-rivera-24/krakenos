import type { ApplyUpdateResponse, CancelUpdateResponse, UpdatePlan } from '@krakenos/types';
import { AlertTriangle, ArrowUpCircle, CheckCircle2, RefreshCw, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CopyButton } from '@/components/ui/copy-button';
import { StatusDot } from '@/components/ui/status-dot';
import { api } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { useT } from '@/lib/i18n';
import { usePolling } from '@/lib/use-polling';
import { useAuthStore } from '@/store/auth.store';
import { toast } from '@/store/toast.store';

/**
 * Actualizaciones (US-116 comprobación + US-190 one-click con rollback). Muestra
 * la versión instalada y, si hay un repo configurado, si existe una release más
 * nueva. En despliegues systemd un admin puede **aplicar la actualización desde
 * aquí** (con rollback automático); en Docker se muestra el comando manual, porque
 * el contenedor no puede auto-reemplazarse. Opt-in: sin `UPDATE_CHECK_REPO`, la
 * comprobación aparece desactivada.
 */
export function UpdateCard() {
  const t = useT();
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin');
  const [plan, setPlan] = useState<UpdatePlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const aliveRef = useRef(true);

  const load = useCallback(async () => {
    try {
      const p = await api.get<UpdatePlan>('/system/update/plan');
      if (aliveRef.current) setPlan(p);
    } catch {
      if (aliveRef.current) setPlan(null);
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    void load();
    return () => {
      aliveRef.current = false;
    };
  }, [load]);

  // Mientras hay una actualización en curso, refresca el plan cada 5 s para ir
  // mostrando el resultado (correcta / revertida) cuando el actualizador termine.
  // US-262: iba con un `setInterval` a pelo y seguía sondeando con la pestaña
  // oculta; `usePolling` lo para y **relee al volver**, que es justo el momento en
  // que alguien vuelve a mirar si la actualización terminó.
  usePolling(load, 5000, { enabled: Boolean(plan?.inProgress) });

  const apply = async () => {
    setApplying(true);
    try {
      const res = await api.post<ApplyUpdateResponse>('/system/update/apply', {});
      if (res.started) {
        toast.success(t('settings.update.started'));
      } else {
        // Motivo generado por el servidor (fuera de ventana, docker, sin cambios…).
        toast.error(res.message || t('settings.update.error'));
      }
      await load();
    } catch (err) {
      toast.error(describeError(err, t('settings.update.error')));
    } finally {
      if (aliveRef.current) setApplying(false);
    }
  };

  /**
   * Libera el lock de «en curso» (US-232). La caducidad automática ya cubre al
   * actualizador muerto; esto es para el que sigue vivo pero atascado, que antes
   * dejaba la función bloqueada sin más salida que borrar el fichero por SSH.
   */
  const cancel = async () => {
    setCancelling(true);
    try {
      const res = await api.post<CancelUpdateResponse>('/system/update/cancel');
      if (res.cancelled) toast.success(t('settings.update.cancelled'));
      else toast.error(res.message || t('settings.update.cancelError'));
      await load();
    } catch (err) {
      toast.error(describeError(err, t('settings.update.cancelError')));
    } finally {
      if (aliveRef.current) setCancelling(false);
    }
  };

  const canApply =
    isAdmin && plan?.canSelfUpdate && plan.updateAvailable && !plan.inProgress && !applying;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.update.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between text-kr-base">
          <span className="text-kr-secondary">{t('settings.update.installed')}</span>
          <span className="font-mono text-kr-primary">{plan?.current ?? '—'}</span>
        </div>

        {loading ? (
          <p className="flex items-center gap-2 text-kr-sm text-kr-muted">
            <RefreshCw className="h-4 w-4 animate-spin" aria-hidden />
            {t('settings.update.checking')}
          </p>
        ) : !plan || !plan.enabled ? (
          <p className="text-kr-sm text-kr-muted">
            {t('settings.update.disabled', { env: 'UPDATE_CHECK_REPO' })}
          </p>
        ) : plan.inProgress ? (
          <div className="space-y-2">
            <p className="flex items-center gap-2 text-kr-sm text-kr-secondary">
              <RefreshCw className="h-4 w-4 animate-spin" aria-hidden />
              {t('settings.update.inProgress')}
            </p>
            {plan.inProgressSince && (
              <p className="text-kr-xs text-kr-muted">
                {t('settings.update.inProgressSince', {
                  time: new Date(plan.inProgressSince).toLocaleTimeString(),
                })}
              </p>
            )}
            {isAdmin && (
              <Button variant="outline" onClick={() => void cancel()} disabled={cancelling}>
                {cancelling ? t('settings.update.cancelling') : t('settings.update.cancel')}
              </Button>
            )}
          </div>
        ) : plan.updateAvailable ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-kr-sm text-warning">
              <ArrowUpCircle className="h-4 w-4 shrink-0" aria-hidden />
              <span>{t('settings.update.available', { version: plan.latest ?? '' })}</span>
            </div>

            {plan.canSelfUpdate ? (
              isAdmin && (
                <Button onClick={() => void apply()} disabled={!canApply}>
                  {applying ? t('settings.update.applying') : t('settings.update.applyNow')}
                </Button>
              )
            ) : (
              <div className="space-y-2">
                <p className="text-kr-sm text-kr-secondary">{t('settings.update.dockerHint')}</p>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-md bg-kr-elevated px-2 py-1 font-mono text-kr-xs text-kr-primary">
                    {plan.dockerCommand}
                  </code>
                  <CopyButton
                    value={plan.dockerCommand ?? ''}
                    label={t('settings.update.copyCommand')}
                    copiedLabel={t('settings.update.copied')}
                  />
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="flex items-center gap-2 text-kr-sm text-success">
            <CheckCircle2 className="h-4 w-4" aria-hidden />
            {t('settings.update.upToDate')}
            {plan.latest ? ` (${plan.latest})` : ''}
          </p>
        )}

        {plan?.maintenanceWindow && !loading && (
          <p className="text-kr-xs text-kr-muted">
            {t('settings.update.maintenanceWindow', { window: plan.maintenanceWindow })}
          </p>
        )}

        {plan?.lastResult && !loading && <LastResult result={plan.lastResult} />}

        {plan?.enabled && !loading && !plan.inProgress && (
          <div className="flex items-center gap-2 text-kr-xs text-kr-muted">
            <StatusDot status="online" />
            {t('settings.update.checkedAgainst')}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Resumen de la última actualización aplicada (correcta / revertida / fallida). */
function LastResult({ result }: { result: NonNullable<UpdatePlan['lastResult']> }) {
  const t = useT();
  if (result.ok) {
    return (
      <p className="flex items-center gap-2 text-kr-xs text-kr-muted">
        <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden />
        {t('settings.update.lastOk', { from: result.fromVersion, to: result.targetVersion ?? '' })}
      </p>
    );
  }
  return (
    <p className="flex items-center gap-2 text-kr-xs text-warning">
      {result.rolledBack ? (
        <RotateCcw className="h-3.5 w-3.5 shrink-0" aria-hidden />
      ) : (
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
      )}
      {result.rolledBack
        ? t('settings.update.lastRolledBack', { from: result.fromVersion })
        : t('settings.update.lastFailed')}
    </p>
  );
}
