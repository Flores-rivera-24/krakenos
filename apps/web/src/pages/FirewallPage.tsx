import type {
  CreateFirewallRuleRequest,
  FirewallAction,
  FirewallProtocol,
  FirewallRule,
} from '@krakenos/types';
import { useEffect, useState, type FormEvent } from 'react';
import { FirewallRuleSlideover } from '@/components/firewall/FirewallRuleSlideover';
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
import { useAuthStore } from '@/store/auth.store';
import { toast } from '@/store/toast.store';

const PROTOCOLS: FirewallProtocol[] = ['any', 'tcp', 'udp'];

/** Ayudas en lenguaje llano para conceptos sin clave de glosario propia. */
const FIREWALL_HELP =
  'Un cortafuegos es el portero de tu red: cada regla decide si una conexión se permite o se bloquea, según de dónde viene, a dónde va y por qué puerto.';
const ACTION_HELP = '«Permitir» deja pasar la conexión; «Bloquear» la corta.';
const SOURCE_HELP =
  'De dónde viene la conexión. Puede ser una IP (192.168.1.50), un rango en formato CIDR (192.168.1.0/24 = toda esa red) o la dirección MAC de un aparato. Déjalo vacío para «cualquiera».';
const DEST_HELP =
  'A dónde va la conexión: una IP, un rango CIDR o un nombre de host. Déjalo vacío para «cualquiera».';

const EMPTY: CreateFirewallRuleRequest = {
  name: '',
  action: 'deny',
  protocol: 'any',
  source: '',
  destination: '',
  port: null,
};

export function FirewallPage() {
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin');
  const [rules, setRules] = useState<FirewallRule[]>([]);
  const [form, setForm] = useState<CreateFirewallRuleRequest>(EMPTY);
  const [portText, setPortText] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<FirewallRule | null>(null);

  const load = () =>
    api
      .get<FirewallRule[]>('/firewall/rules')
      .then(setRules)
      .catch((err) => setError(describeError(err, 'No se pudieron cargar las reglas')));

  useEffect(() => {
    void load().finally(() => setLoading(false));
  }, []);

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
      toast.success('Regla creada');
      void load();
    } catch (err) {
      toast.error(describeError(err, 'No se pudo crear la regla'));
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
      toast.success('Regla eliminada');
      void load();
    } catch (err) {
      toast.error(describeError(err, 'No se pudo eliminar'));
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div>
        <div className="flex items-center gap-1.5">
          <h2 className="text-xl font-semibold">Firewall</h2>
          <HelpHint content={FIREWALL_HELP} label="¿Qué es un cortafuegos?" />
        </div>
        <p className="text-sm text-muted-foreground">
          Reglas que permiten o bloquean el tráfico por origen, destino, protocolo y puerto. Se
          evalúan por prioridad.
        </p>
      </div>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base text-foreground">Nueva regla</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={addRule} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
              <div className="space-y-2 lg:col-span-2">
                <Label htmlFor="fw-name">Nombre</Label>
                <Input
                  id="fw-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="p. ej. Bloquear cámara"
                  maxLength={60}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="fw-action">Acción</Label>
                  <HelpHint content={ACTION_HELP} label="¿Qué hace la acción?" />
                </div>
                <select
                  id="fw-action"
                  value={form.action}
                  onChange={(e) => setForm({ ...form, action: e.target.value as FirewallAction })}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="deny">deny</option>
                  <option value="allow">allow</option>
                </select>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="fw-protocol">Protocolo</Label>
                  <GlossaryHint termKey="protocolo" />
                </div>
                <select
                  id="fw-protocol"
                  value={form.protocol}
                  onChange={(e) =>
                    setForm({ ...form, protocol: e.target.value as FirewallProtocol })
                  }
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {PROTOCOLS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="fw-source">Origen</Label>
                  <HelpHint content={SOURCE_HELP} label="¿Qué es el origen?" />
                </div>
                <Input
                  id="fw-source"
                  value={form.source ?? ''}
                  onChange={(e) => setForm({ ...form, source: e.target.value })}
                  placeholder="IP/CIDR/MAC"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="fw-dest">Destino</Label>
                  <HelpHint content={DEST_HELP} label="¿Qué es el destino?" />
                </div>
                <Input
                  id="fw-dest"
                  value={form.destination ?? ''}
                  onChange={(e) => setForm({ ...form, destination: e.target.value })}
                  placeholder="IP/CIDR/host"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="fw-port">Puerto</Label>
                  <GlossaryHint termKey="puerto" />
                </div>
                <Input
                  id="fw-port"
                  value={portText}
                  onChange={(e) => setPortText(e.target.value.replace(/\D/g, ''))}
                  placeholder="cualquiera"
                  inputMode="numeric"
                />
              </div>
              <div className="flex items-end">
                <Button type="submit" disabled={busy} className="w-full">
                  {busy ? 'Creando…' : 'Añadir regla'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base text-foreground">Reglas</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-secondary text-secondary-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Activa</th>
                  <th className="px-3 py-2 text-left">Nombre</th>
                  <th className="px-3 py-2 text-left">Acción</th>
                  <th className="px-3 py-2 text-left">Protocolo</th>
                  <th className="px-3 py-2 text-left">Origen</th>
                  <th className="px-3 py-2 text-left">Destino</th>
                  <th className="px-3 py-2 text-left">Puerto</th>
                  {isAdmin && <th className="px-3 py-2 text-right">Acción</th>}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <SkeletonRows cols={isAdmin ? 8 : 7} />
                ) : rules.length === 0 ? (
                  <tr>
                    <td colSpan={isAdmin ? 8 : 7} className="px-3 py-8 text-center">
                      <p className="text-kr-muted">Aún no hay reglas configuradas.</p>
                      <p className="mx-auto mt-1 max-w-md text-kr-xs text-kr-secondary">
                        El cortafuegos decide qué conexiones se permiten y cuáles se bloquean. Sin
                        reglas, todo el tráfico pasa.{' '}
                        {isAdmin && 'Crea una arriba para, por ejemplo, impedir que un aparato salga a internet.'}
                      </p>
                    </td>
                  </tr>
                ) : (
                  rules.map((r) => (
                    <tr
                      key={r.id}
                      className="cursor-pointer border-t border-border hover:bg-secondary/40"
                      onClick={() => setSelected(r)}
                    >
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        <OptimisticSwitch
                          checked={r.enabled}
                          onToggle={(next) => toggleRule(r, next)}
                          disabled={!isAdmin}
                          errorMessage={`No se pudo actualizar ${r.name}`}
                          aria-label={`Activar regla ${r.name}`}
                        />
                      </td>
                      <td className="px-3 py-2">{r.name}</td>
                      <td className="px-3 py-2">
                        <span
                          className={r.action === 'deny' ? 'text-destructive' : 'text-green-500'}
                        >
                          {r.action}
                        </span>
                      </td>
                      <td className="px-3 py-2 uppercase text-muted-foreground">{r.protocol}</td>
                      <td className="px-3 py-2 font-mono text-xs">{r.source ?? '*'}</td>
                      <td className="px-3 py-2 font-mono text-xs">{r.destination ?? '*'}</td>
                      <td className="px-3 py-2 font-mono text-xs">{r.port ?? '*'}</td>
                      {isAdmin && (
                        <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                          <DeleteButton
                            onDelete={() => removeRule(r.id)}
                            aria-label={`Eliminar regla ${r.name}`}
                          >
                            Eliminar
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

      {selected && (
        <FirewallRuleSlideover
          rule={selected}
          canEdit={isAdmin}
          onClose={() => setSelected(null)}
          onSaved={load}
        />
      )}
    </div>
  );
}
