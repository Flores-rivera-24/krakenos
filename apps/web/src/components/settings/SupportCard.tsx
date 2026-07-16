import type { TelemetrySnapshot, UpdatePlan } from '@krakenos/types';
import { Bug, Download, LifeBuoy, MessageSquarePlus, Router } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { buildIssueUrl, type FeedbackKind } from '@/lib/feedback';
import { useT } from '@/lib/i18n';
import { downloadSupportBundle } from '@/lib/support';
import { toast } from '@/store/toast.store';

/**
 * Soporte y diagnóstico (US-192): telemetría anónima opt-in (OFF por defecto) +
 * descarga del bundle de soporte sanitizado (sin secretos ni PII). Solo admin.
 */
export function SupportCard() {
  const t = useT();
  const [telemetry, setTelemetry] = useState<TelemetrySnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);
  // Contexto para pre-rellenar el issue (US-218): versión + modo de despliegue.
  const [plan, setPlan] = useState<UpdatePlan | null>(null);

  useEffect(() => {
    let active = true;
    void api
      .get<TelemetrySnapshot>('/system/telemetry')
      .then((t2) => active && setTelemetry(t2))
      .catch(() => undefined);
    void api
      .get<UpdatePlan>('/system/update/plan')
      .then((p) => active && setPlan(p))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  /** Abre el issue pre-rellenado en GitHub. Nada se envía solo: el usuario pega. */
  const openIssue = (kind: FeedbackKind) => {
    const url = buildIssueUrl(kind, { version: plan?.current, deployMode: plan?.mode });
    window.open(url, '_blank', 'noopener');
  };

  const toggleTelemetry = async () => {
    const next = !telemetry?.enabled;
    setBusy(true);
    try {
      await api.patch('/system/settings', { key: 'telemetryEnabled', value: next ? 'on' : 'off' });
      const fresh = await api.get<TelemetrySnapshot>('/system/telemetry');
      setTelemetry(fresh);
      toast.success(next ? t('settings.support.telemetryOn') : t('settings.support.telemetryOff'));
    } catch (err) {
      toast.error(describeError(err, t('settings.support.telemetryError')));
    } finally {
      setBusy(false);
    }
  };

  const download = async () => {
    setDownloading(true);
    try {
      const blob = await downloadSupportBundle();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `krakenos-support-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(describeError(err, t('settings.support.error')));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LifeBuoy className="h-4 w-4 text-kr-accent" aria-hidden />
          {t('settings.support.title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-medium text-kr-primary">{t('settings.support.telemetry')}</p>
            <p className="text-kr-xs text-kr-muted">{t('settings.support.telemetryDesc')}</p>
            {telemetry?.enabled && telemetry.counts && (
              <p className="mt-1 text-kr-xs text-kr-secondary">
                {t('settings.support.counts', {
                  devices: telemetry.counts.devices,
                  automations: telemetry.counts.automations,
                })}
              </p>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={busy || !telemetry}
            aria-pressed={telemetry?.enabled ?? false}
            onClick={() => void toggleTelemetry()}
          >
            {telemetry?.enabled ? t('settings.support.disable') : t('settings.support.enable')}
          </Button>
        </div>

        <div className="border-t border-kr pt-3">
          <p className="text-kr-xs text-kr-muted">{t('settings.support.downloadDesc')}</p>
          <Button className="mt-2" disabled={downloading} onClick={() => void download()}>
            <Download className="mr-2 h-4 w-4" aria-hidden />
            {downloading ? t('settings.support.downloading') : t('settings.support.download')}
          </Button>
        </div>

        {/* Feedback (US-218): abre un issue pre-rellenado en GitHub; local-first,
            nada se envía solo — el usuario adjunta el bundle si quiere. */}
        <div className="border-t border-kr pt-3">
          <p className="font-medium text-kr-primary">{t('settings.feedback.title')}</p>
          <p className="text-kr-xs text-kr-muted">{t('settings.feedback.desc')}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => openIssue('bug')}>
              <Bug className="mr-2 h-4 w-4" aria-hidden />
              {t('settings.feedback.bug')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => openIssue('hardware-report')}>
              <Router className="mr-2 h-4 w-4" aria-hidden />
              {t('settings.feedback.hardware')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => openIssue('feature')}>
              <MessageSquarePlus className="mr-2 h-4 w-4" aria-hidden />
              {t('settings.feedback.feature')}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
