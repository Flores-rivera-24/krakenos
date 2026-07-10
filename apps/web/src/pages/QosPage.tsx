import type { CreateQosRuleRequest, QosPriority, QosRule } from '@krakenos/types';
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DeleteButton } from '@/components/ui/delete-button';
import { GlossaryHint } from '@/components/ui/glossary-hint';
import { HelpHint } from '@/components/ui/help-hint';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { OptimisticSwitch } from '@/components/ui/optimistic-switch';
import { ErrorBanner } from '@/components/ui/error-banner';
import { SkeletonRows } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { useT } from '@/lib/i18n';
import { useAuthStore } from '@/store/auth.store';
import { toast } from '@/store/toast.store';

const PRIORITIES: QosPriority[] = ['high', 'normal', 'low'];

const PRIORITY_CLASS: Record<QosPriority, string> = {
  high: 'text-green-500',
  normal: 'text-muted-foreground',
  low: 'text-amber-500',
};

const EMPTY: CreateQosRuleRequest = { name: '', target: '', priority: 'normal' };

/** Formatea kbps a una etiqueta legible; `0` = sin límite. */
function formatLimit(kbps: number): string {
  if (kbps === 0) return '∞';
  if (kbps >= 1000) return `${(kbps / 1000).toFixed(kbps % 1000 ? 1 : 0)} Mbps`;
  return `${kbps} kbps`;
}

export function QosPage() {
  const t = useT();
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin');
  const priorityLabel: Record<QosPriority, string> = {
    high: t('qos.priority.high'),
    normal: t('qos.priority.normal'),
    low: t('qos.priority.low'),
  };
  const [rules, setRules] = useState<QosRule[]>([]);
  const [form, setForm] = useState<CreateQosRuleRequest>(EMPTY);
  const [downText, setDownText] = useState('');
  const [upText, setUpText] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api
      .get<QosRule[]>('/qos/rules')
      .then(setRules)
      .catch((err) => setError(describeError(err, t('qos.loadError'))));

  useEffect(() => {
    void load().finally(() => setLoading(false));
  }, []);

  const addRule = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.target.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.post<QosRule>('/qos/rules', {
        name: form.name.trim(),
        target: form.target.trim(),
        priority: form.priority,
        downloadKbps: downText.trim() === '' ? 0 : Number(downText),
        uploadKbps: upText.trim() === '' ? 0 : Number(upText),
      });
      setForm(EMPTY);
      setDownText('');
      setUpText('');
      toast.success(t('qos.ruleCreated'));
      void load();
    } catch (err) {
      toast.error(describeError(err, t('qos.createError')));
    } finally {
      setBusy(false);
    }
  };

  // Toggle optimista: revierte y avisa si falla (US-96); en éxito refresca la fila.
  const toggleRule = (rule: QosRule, next: boolean) =>
    api
      .patch<QosRule>(`/qos/rules/${rule.id}`, { enabled: next })
      .then((updated) => setRules((prev) => prev.map((r) => (r.id === updated.id ? updated : r))));

  const removeRule = async (id: string) => {
    try {
      await api.del(`/qos/rules/${id}`);
      toast.success(t('qos.ruleRemoved'));
      void load();
    } catch (err) {
      toast.error(describeError(err, t('qos.removeError')));
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div>
        <div className="flex items-center gap-1.5">
          <h2 className="text-xl font-semibold">{t('qos.title')}</h2>
          <GlossaryHint termKey="qos" />
        </div>
        <p className="text-sm text-muted-foreground">{t('qos.subtitle')}</p>
      </div>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base text-foreground">{t('qos.newRule')}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={addRule} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
              <div className="space-y-2 lg:col-span-2">
                <Label htmlFor="qos-name">{t('qos.name')}</Label>
                <Input
                  id="qos-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder={t('qos.namePlaceholder')}
                  maxLength={60}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="qos-target">{t('qos.target')}</Label>
                  <HelpHint content={t('qos.targetHelp')} label={t('qos.targetHelpLabel')} />
                </div>
                <Input
                  id="qos-target"
                  value={form.target}
                  onChange={(e) => setForm({ ...form, target: e.target.value })}
                  placeholder={t('qos.targetPlaceholder')}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="qos-priority">{t('qos.priority')}</Label>
                  <HelpHint content={t('qos.priorityHelp')} label={t('qos.priorityHelpLabel')} />
                </div>
                <select
                  id="qos-priority"
                  value={form.priority}
                  onChange={(e) => setForm({ ...form, priority: e.target.value as QosPriority })}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {priorityLabel[p]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="qos-down">{t('qos.download')}</Label>
                  <HelpHint content={t('qos.kbpsHelp')} label={t('qos.kbpsHelpLabel')} />
                </div>
                <Input
                  id="qos-down"
                  value={downText}
                  onChange={(e) => setDownText(e.target.value.replace(/\D/g, ''))}
                  placeholder="0"
                  inputMode="numeric"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="qos-up">{t('qos.upload')}</Label>
                <Input
                  id="qos-up"
                  value={upText}
                  onChange={(e) => setUpText(e.target.value.replace(/\D/g, ''))}
                  placeholder="0"
                  inputMode="numeric"
                />
              </div>
              <div className="flex items-end lg:col-span-6">
                <Button type="submit" disabled={busy}>
                  {busy ? t('qos.creating') : t('qos.addRule')}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base text-foreground">{t('qos.rules')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-secondary text-secondary-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">{t('qos.col.active')}</th>
                  <th className="px-3 py-2 text-left">{t('qos.col.name')}</th>
                  <th className="px-3 py-2 text-left">{t('qos.col.target')}</th>
                  <th className="px-3 py-2 text-left">{t('qos.col.priority')}</th>
                  <th className="px-3 py-2 text-left">↓</th>
                  <th className="px-3 py-2 text-left">↑</th>
                  {isAdmin && <th className="px-3 py-2 text-right">{t('qos.col.action')}</th>}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <SkeletonRows cols={isAdmin ? 7 : 6} />
                ) : rules.length === 0 ? (
                  <tr>
                    <td colSpan={isAdmin ? 7 : 6} className="px-3 py-8 text-center">
                      <p className="text-kr-muted">{t('qos.empty.title')}</p>
                      <p className="mx-auto mt-1 max-w-md text-kr-xs text-kr-secondary">
                        {t('qos.empty.desc')} {isAdmin && t('qos.empty.cta')}
                      </p>
                    </td>
                  </tr>
                ) : (
                  rules.map((r) => (
                    <tr key={r.id} className="border-t border-border">
                      <td className="px-3 py-2">
                        <OptimisticSwitch
                          checked={r.enabled}
                          onToggle={(next) => toggleRule(r, next)}
                          disabled={!isAdmin}
                          errorMessage={t('qos.toggleError', { name: r.name })}
                          aria-label={t('qos.toggleLabel', { name: r.name })}
                        />
                      </td>
                      <td className="px-3 py-2">{r.name}</td>
                      <td className="px-3 py-2 font-mono text-xs">{r.target}</td>
                      <td className={`px-3 py-2 ${PRIORITY_CLASS[r.priority]}`}>
                        {priorityLabel[r.priority]}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{formatLimit(r.downloadKbps)}</td>
                      <td className="px-3 py-2 font-mono text-xs">{formatLimit(r.uploadKbps)}</td>
                      {isAdmin && (
                        <td className="px-3 py-2 text-right">
                          <DeleteButton
                            onDelete={() => removeRule(r.id)}
                            aria-label={t('qos.deleteLabel', { name: r.name })}
                          >
                            {t('qos.delete')}
                          </DeleteButton>
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
