import type { AlertRule } from '@krakenos/types';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadingLine } from '@/components/ui/loading-line';
import { Switch } from '@/components/ui/switch';
import { listAlertRules, updateAlertRule } from '@/lib/alerts';
import { describeError } from '@/lib/errors';
import { toast } from '@/store/toast.store';

/** Reglas de alerta configurables (US-112): qué eventos avisan y por qué canal. */
export function AlertRulesCard() {
  const [rules, setRules] = useState<AlertRule[] | null>(null);

  const load = async () => {
    try {
      setRules(await listAlertRules());
    } catch (err) {
      toast.error(describeError(err, 'No se pudieron cargar las alertas'));
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
      toast.error(describeError(err, 'No se pudo cambiar la alerta'));
      await load();
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Alertas</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-kr-sm text-kr-secondary">
          Elige qué eventos de seguridad te avisan y por qué canal. El email requiere SMTP y
          Telegram un bot (TELEGRAM_*) configurados en el servidor.
        </p>
        {rules === null ? (
          <LoadingLine />
        ) : (
          <div className="overflow-x-auto rounded-md border border-kr">
            <table className="w-full text-kr-sm">
              <thead className="bg-kr-elevated text-kr-secondary">
                <tr>
                  <th className="px-3 py-2 text-left">Evento</th>
                  <th className="px-3 py-2">Push</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Telegram</th>
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
                        aria-label={`Push: ${r.label}`}
                      />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <Switch
                        checked={r.email}
                        onCheckedChange={(v) => void toggle(r, 'email', v)}
                        aria-label={`Email: ${r.label}`}
                      />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <Switch
                        checked={r.telegram}
                        onCheckedChange={(v) => void toggle(r, 'telegram', v)}
                        aria-label={`Telegram: ${r.label}`}
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
