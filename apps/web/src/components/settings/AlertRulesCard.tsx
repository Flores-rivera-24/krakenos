import type { AlertRule } from '@krakenos/types';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadingLine } from '@/components/ui/loading-line';
import { Switch } from '@/components/ui/switch';
import { claveDeAlerta, listAlertRules, updateAlertRule } from '@/lib/alerts';
import { describeError } from '@/lib/errors';
import { useT } from '@/lib/i18n';
import { toast } from '@/store/toast.store';

/** Reglas de alerta configurables (US-112): qué eventos avisan y por qué canal. */
export function AlertRulesCard() {
  const t = useT();
  const [rules, setRules] = useState<AlertRule[] | null>(null);

  const load = async () => {
    try {
      setRules(await listAlertRules());
    } catch (err) {
      toast.error(describeError(err, t('alerts.loadError')));
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const toggle = async (rule: AlertRule, channel: 'push' | 'email' | 'telegram', value: boolean) => {
    // Optimista: refleja ya el cambio y revierte si falla.
    setRules(
      (cur) => cur?.map((r) => (r.event === rule.event ? { ...r, [channel]: value } : r)) ?? cur,
    );
    try {
      await updateAlertRule(rule.event, { [channel]: value });
    } catch (err) {
      toast.error(describeError(err, t('alerts.toggleError')));
      await load();
    }
  };

  /**
   * US-270: la etiqueta la pone la web, no el agente. Un evento que esta versión
   * no conoce se nombra como desconocido en vez de enseñar su identificador
   * crudo: `event` llega del servidor, y un agente más nuevo puede anunciar
   * eventos que este catálogo todavía no tiene.
   */
  const etiqueta = (event: string): string => {
    const clave = claveDeAlerta(event);
    return clave ? t(clave) : t('alerts.unknownEvent');
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('alerts.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-kr-sm text-kr-secondary">{t('alerts.intro')}</p>
        {rules === null ? (
          <LoadingLine />
        ) : (
          <div className="overflow-x-auto rounded-md border border-kr">
            <table className="w-full text-kr-sm">
              <thead className="bg-kr-elevated text-kr-secondary">
                <tr>
                  <th className="px-3 py-2 text-left">{t('alerts.col.event')}</th>
                  <th className="px-3 py-2">{t('alerts.col.push')}</th>
                  <th className="px-3 py-2">{t('alerts.col.email')}</th>
                  <th className="px-3 py-2">{t('alerts.col.telegram')}</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.event} className="border-t border-kr">
                    <td className="px-3 py-2 text-kr-primary">{etiqueta(r.event)}</td>
                    <td className="px-3 py-2 text-center">
                      <Switch
                        checked={r.push}
                        onCheckedChange={(v) => void toggle(r, 'push', v)}
                        aria-label={t('alerts.aria.push', { event: etiqueta(r.event) })}
                      />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <Switch
                        checked={r.email}
                        onCheckedChange={(v) => void toggle(r, 'email', v)}
                        aria-label={t('alerts.aria.email', { event: etiqueta(r.event) })}
                      />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <Switch
                        checked={r.telegram}
                        onCheckedChange={(v) => void toggle(r, 'telegram', v)}
                        aria-label={t('alerts.aria.telegram', { event: etiqueta(r.event) })}
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
