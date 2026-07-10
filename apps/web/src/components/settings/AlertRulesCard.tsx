import type { AlertRule } from '@krakenos/types';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadingLine } from '@/components/ui/loading-line';
import { Switch } from '@/components/ui/switch';
import { useT } from '@/lib/i18n';
import { listAlertRules, updateAlertRule } from '@/lib/alerts';
import { describeError } from '@/lib/errors';
import { toast } from '@/store/toast.store';

/** Reglas de alerta configurables (US-112): qué eventos avisan y por qué canal. */
export function AlertRulesCard() {
  const t = useT();
  const [rules, setRules] = useState<AlertRule[] | null>(null);

  const load = async () => {
    try {
      setRules(await listAlertRules());
    } catch (err) {
      toast.error(describeError(err, t('settings.alerts.loadError')));
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const toggle = async (rule: AlertRule, channel: 'push' | 'email' | 'telegram', value: boolean) => {
    // Optimista: refleja ya el cambio y revierte si falla.
    setRules((cur) => cur?.map((r) => (r.event === rule.event ? { ...r, [channel]: value } : r)) ?? cur);
    try {
      await updateAlertRule(rule.event, { [channel]: value });
    } catch (err) {
      toast.error(describeError(err, t('settings.alerts.toggleError')));
      await load();
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.alerts.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-kr-sm text-kr-secondary">{t('settings.alerts.description')}</p>
        {rules === null ? (
          <LoadingLine />
        ) : (
          <div className="overflow-x-auto rounded-md border border-kr">
            <table className="w-full text-kr-sm">
              <thead className="bg-kr-elevated text-kr-secondary">
                <tr>
                  <th className="px-3 py-2 text-left">{t('settings.alerts.colEvent')}</th>
                  <th className="px-3 py-2">{t('settings.alerts.colPush')}</th>
                  <th className="px-3 py-2">{t('settings.alerts.colEmail')}</th>
                  <th className="px-3 py-2">{t('settings.alerts.colTelegram')}</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.event} className="border-t border-kr">
                    <td className="px-3 py-2 text-kr-primary">{r.label}</td>
                    <td className="px-3 py-2 text-center">
                      <Switch
                        checked={r.push}
                        onCheckedChange={(v) => void toggle(r, 'push', v)}
                        aria-label={t('settings.alerts.ariaPush', { label: r.label })}
                      />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <Switch
                        checked={r.email}
                        onCheckedChange={(v) => void toggle(r, 'email', v)}
                        aria-label={t('settings.alerts.ariaEmail', { label: r.label })}
                      />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <Switch
                        checked={r.telegram}
                        onCheckedChange={(v) => void toggle(r, 'telegram', v)}
                        aria-label={t('settings.alerts.ariaTelegram', { label: r.label })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
