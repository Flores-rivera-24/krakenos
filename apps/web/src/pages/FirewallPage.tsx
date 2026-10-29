import type {
  CreateFirewallRuleRequest,
  FirewallAction,
  FirewallProtocol,
  FirewallRule,
  GatewayStatusResponse,
} from '@krakenos/types';
import { useEffect, useState, type FormEvent } from 'react';
import { FirewallRuleSlideover } from '@/components/firewall/FirewallRuleSlideover';
import { GatewayCapabilityNotice } from '@/components/gateway/GatewayCapabilityNotice';
import { DemoNoticeFor } from '@/components/integrations/DomainNotice';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DeleteButton } from '@/components/ui/delete-button';
import { GlossaryHint } from '@/components/ui/glossary-hint';
import { HelpHint } from '@/components/ui/help-hint';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { OptimisticSwitch } from '@/components/ui/optimistic-switch';
import { Callout } from '@/components/ui/callout';
import { ErrorBanner } from '@/components/ui/error-banner';
import { SkeletonRows } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { useT } from '@/lib/i18n';
import { useAuthStore } from '@/store/auth.store';
import { toast } from '@/store/toast.store';
import { filaAbrible } from '@/lib/a11y';
import '@/lib/i18n/catalog/fragments/firewall';

const PROTOCOLS: FirewallProtocol[] = ['any', 'tcp', 'udp'];

const EMPTY: CreateFirewallRuleRequest = {
  name: '',
  action: 'deny',
  protocol: 'any',
  source: '',
  destination: '',
  port: null,
};

export function FirewallPage() {
  const t = useT();
  // Etiquetas visibles (el valor de la API no cambia): mismas palabras que firewall.actionHelp.
  const actionLabel: Record<FirewallAction, string> = {
    deny: t('firewall.action.deny'),
    allow: t('firewall.action.allow'),
  };
  const protocolLabel: Record<FirewallProtocol, string> = {
    any: t('firewall.protocol.any'),
    tcp: 'TCP',
    udp: 'UDP',
  };
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin');
  const [rules, setRules] = useState<FirewallRule[]>([]);
  // Capacidad de ESTE equipo para aplicar reglas; `null` = aún sin saber (cargando o fallo).
  const [capability, setCapability] = useState<GatewayStatusResponse['capability'] | null>(null);
  const [form, setForm] = useState<CreateFirewallRuleRequest>(EMPTY);
  const [portText, setPortText] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(isAdmin);
  // La carga falló: «sin reglas» no es un hecho comprobado, así que no se pinta el estado vacío.
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<FirewallRule | null>(null);

  const load = () =>
    api
      .getList<FirewallRule>('/firewall/rules')
      .then((list) => {
        setRules(list);
        setLoadFailed(false);
      })
      .catch((err) => {
        setLoadFailed(true);
        setError(describeError(err, t('firewall.loadError')));
      });

  const loadCapability = () =>
    api
      .get<GatewayStatusResponse>('/firewall/status')
      .then((s) => setCapability(s.capability))
      .catch((err) => setError(describeError(err, t('firewall.loadError'))));

  useEffect(() => {
    // Todo el módulo de cortafuegos es solo admin en el servidor: a otro rol ni se le pide.
    if (!isAdmin) return;
    void Promise.all([load(), loadCapability()]).finally(() => setLoading(false));
  }, [isAdmin]);

  // Solo con un equipo que puede aplicar reglas se ofrece crearlas, activarlas o eliminarlas:
  // si no, cada control acabaría en error. Sin saberlo todavía, tampoco.
  const canConfigure = isAdmin && capability?.status === 'supported';
  // Sin configurar el aviso lo dice todo: la lista vacía («aún no hay reglas») culparía al usuario.
  const sinConfigurar = capability?.status === 'not-configured';

  const addRule = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const port = portText.trim() === '' ? null : Number(portText);
      await api.post<FirewallRule>('/firewall/rules', {
        name: form.name.trim(),
        action: form.action,
        protocol: form.protocol,
        source: form.source?.trim() || null,
        destination: form.destination?.trim() || null,
        port,
      });
      setForm(EMPTY);
      setPortText('');
      toast.success(t('firewall.ruleCreated'));
      void load();
    } catch (err) {
      toast.error(describeError(err, t('firewall.createError')));
    } finally {
      setBusy(false);
    }
  };

  // Toggle optimista: el `OptimisticSwitch` revierte y avisa si falla (US-96);
  // en éxito refrescamos solo esa fila con lo que devuelve el servidor.
  const toggleRule = (rule: FirewallRule, next: boolean) =>
    api
      .patch<FirewallRule>(`/firewall/rules/${rule.id}`, { enabled: next })
      .then((updated) => setRules((prev) => prev.map((r) => (r.id === updated.id ? updated : r))));

  const removeRule = async (id: string) => {
    try {
      await api.del(`/firewall/rules/${id}`);
      toast.success(t('firewall.ruleRemoved'));
      void load();
    } catch (err) {
      toast.error(describeError(err, t('firewall.removeError')));
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div>
        <div className="flex items-center gap-1.5">
          <h1 className="text-kr-xl font-semibold text-kr-primary">{t('firewall.title')}</h1>
          <HelpHint content={t('firewall.help')} label={t('firewall.helpLabel')} />
        </div>
        <p className="text-sm text-muted-foreground">{t('firewall.subtitle')}</p>
      </div>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      {isAdmin && capability && !canConfigure && (
        <GatewayCapabilityNotice capability={capability} feature="firewall" />
      )}
      {/* Nunca dos avisos a la vez: el de demostración solo sale si el equipo no tiene otro. */}
      {isAdmin && canConfigure && <DemoNoticeFor domain="firewall" />}

      {canConfigure && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base text-foreground">{t('firewall.newRule')}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={addRule} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
              <div className="space-y-2 lg:col-span-2">
                <Label htmlFor="fw-name">{t('firewall.name')}</Label>
                <Input
                  id="fw-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder={t('firewall.namePlaceholder')}
                  maxLength={60}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="fw-action">{t('firewall.action')}</Label>
                  <HelpHint
                    content={t('firewall.actionHelp')}
                    label={t('firewall.actionHelpLabel')}
                  />
                </div>
                <select
                  id="fw-action"
                  value={form.action}
                  onChange={(e) => setForm({ ...form, action: e.target.value as FirewallAction })}
                  className="h-10 w-full rounded-md border border-kr-field bg-background px-3 text-base md:text-sm min-h-11 md:min-h-0"
                >
                  <option value="deny">{actionLabel.deny}</option>
                  <option value="allow">{actionLabel.allow}</option>
                </select>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="fw-protocol">{t('firewall.protocol')}</Label>
                  <GlossaryHint termKey="protocolo" />
                </div>
                <select
                  id="fw-protocol"
                  value={form.protocol}
                  onChange={(e) =>
                    setForm({ ...form, protocol: e.target.value as FirewallProtocol })
                  }
                  className="h-10 w-full rounded-md border border-kr-field bg-background px-3 text-base md:text-sm min-h-11 md:min-h-0"
                >
                  {PROTOCOLS.map((p) => (
                    <option key={p} value={p}>
                      {protocolLabel[p]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="fw-source">{t('firewall.source')}</Label>
                  <HelpHint
                    content={t('firewall.sourceHelp')}
                    label={t('firewall.sourceHelpLabel')}
                  />
                </div>
                <Input
                  id="fw-source"
                  value={form.source ?? ''}
                  onChange={(e) => setForm({ ...form, source: e.target.value })}
                  placeholder={t('firewall.sourcePlaceholder')}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="fw-dest">{t('firewall.dest')}</Label>
                  <HelpHint content={t('firewall.destHelp')} label={t('firewall.destHelpLabel')} />
                </div>
                <Input
                  id="fw-dest"
                  value={form.destination ?? ''}
                  onChange={(e) => setForm({ ...form, destination: e.target.value })}
                  placeholder={t('firewall.destPlaceholder')}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="fw-port">{t('firewall.port')}</Label>
                  <GlossaryHint termKey="puerto" />
                </div>
                <Input
                  id="fw-port"
                  value={portText}
                  onChange={(e) => setPortText(e.target.value.replace(/\D/g, ''))}
                  placeholder={t('firewall.portPlaceholder')}
                  inputMode="numeric"
                />
              </div>
              <div className="flex items-end">
                <Button type="submit" disabled={busy} className="w-full">
                  {busy ? t('firewall.creating') : t('firewall.addRule')}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {!sinConfigurar && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base text-foreground">{t('firewall.rules')}</CardTitle>
          </CardHeader>
          <CardContent>
            {!isAdmin ? (
              <Callout variant="info" standing title={t('firewall.adminOnly')}>
                {t('firewall.adminOnlyDesc')}
              </Callout>
            ) : (
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-secondary text-secondary-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">{t('firewall.col.active')}</th>
                      <th className="px-3 py-2 text-left">{t('firewall.col.name')}</th>
                      <th className="px-3 py-2 text-left">{t('firewall.col.action')}</th>
                      <th className="px-3 py-2 text-left">{t('firewall.col.protocol')}</th>
                      <th className="px-3 py-2 text-left">{t('firewall.col.source')}</th>
                      <th className="px-3 py-2 text-left">{t('firewall.col.dest')}</th>
                      <th className="px-3 py-2 text-left">{t('firewall.col.port')}</th>
                      {isAdmin && (
                        <th className="px-3 py-2 text-right">{t('firewall.col.action')}</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <SkeletonRows cols={isAdmin ? 8 : 7} />
                    ) : rules.length === 0 && loadFailed ? (
                      <tr>
                        <td
                          colSpan={isAdmin ? 8 : 7}
                          className="px-3 py-8 text-center text-kr-muted"
                        >
                          {t('firewall.loadError')}
                        </td>
                      </tr>
                    ) : rules.length === 0 ? (
                      <tr>
                        <td colSpan={isAdmin ? 8 : 7} className="px-3 py-8 text-center">
                          <p className="text-kr-muted">{t('firewall.empty.title')}</p>
                          <p className="mx-auto mt-1 max-w-md text-kr-xs text-kr-secondary">
                            {t('firewall.empty.desc')} {canConfigure && t('firewall.empty.cta')}
                          </p>
                        </td>
                      </tr>
                    ) : (
                      rules.map((r) => (
                        <tr
                          key={r.id}
                          className="cursor-pointer border-t border-border hover:bg-secondary/40 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-kr-accent"
                          {...filaAbrible(
                            () => setSelected(r),
                            t('firewall.ruleRowAria', { name: r.name }),
                          )}
                        >
                          <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                            <OptimisticSwitch
                              checked={r.enabled}
                              onToggle={(next) => toggleRule(r, next)}
                              disabled={!canConfigure}
                              errorMessage={t('firewall.toggleError', { name: r.name })}
                              aria-label={t('firewall.toggleLabel', { name: r.name })}
                            />
                          </td>
                          <td className="px-3 py-2">{r.name}</td>
                          <td className="px-3 py-2">
                            <span className={r.action === 'deny' ? 'text-danger' : 'text-success'}>
                              {actionLabel[r.action]}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {protocolLabel[r.protocol]}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs">{r.source ?? '*'}</td>
                          <td className="px-3 py-2 font-mono text-xs">{r.destination ?? '*'}</td>
                          <td className="px-3 py-2 font-mono text-xs">{r.port ?? '*'}</td>
                          {isAdmin && (
                            <td
                              className="px-3 py-2 text-right"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {canConfigure && (
                                <DeleteButton
                                  onDelete={() => removeRule(r.id)}
                                  aria-label={t('firewall.deleteLabel', { name: r.name })}
                                >
                                  {t('firewall.delete')}
                                </DeleteButton>
                              )}
                            </td>
                          )}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {selected && (
        <FirewallRuleSlideover
          rule={selected}
          canEdit={canConfigure}
          onClose={() => setSelected(null)}
          onSaved={load}
        />
      )}
    </div>
  );
}
