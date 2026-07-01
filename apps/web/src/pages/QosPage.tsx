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
import { useAuthStore } from '@/store/auth.store';
import { toast } from '@/store/toast.store';

const PRIORITIES: QosPriority[] = ['high', 'normal', 'low'];

/** Ayudas en lenguaje llano para conceptos sin clave de glosario propia. */
const TARGET_HELP =
  'El aparato o servicio al que se aplica la regla: su IP (192.168.1.50), su dirección MAC o el nombre de un servicio.';
const PRIORITY_HELP =
  'Cuando la red se satura, el tráfico de prioridad alta pasa primero y el de prioridad baja espera. La mayoría del tráfico va en «Normal».';
const KBPS_HELP =
  'Límite de velocidad en kbps (1000 kbps ≈ 1 Mbps). Escribe 0 para no poner límite.';

const PRIORITY_LABEL: Record<QosPriority, string> = {
  high: 'Alta',
  normal: 'Normal',
  low: 'Baja',
};

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
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin');
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
      .catch((err) => setError(describeError(err, 'No se pudieron cargar las reglas')));

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
      toast.success('Regla creada');
      void load();
    } catch (err) {
      toast.error(describeError(err, 'No se pudo crear la regla'));
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
          <h2 className="text-xl font-semibold">QoS</h2>
          <GlossaryHint termKey="qos" />
        </div>
        <p className="text-sm text-muted-foreground">
          Prioriza y limita el ancho de banda por dispositivo o servicio.
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
                <Label htmlFor="qos-name">Nombre</Label>
                <Input
                  id="qos-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="p. ej. Prioridad trabajo"
                  maxLength={60}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="qos-target">Objetivo</Label>
                  <HelpHint content={TARGET_HELP} label="¿Qué es el objetivo?" />
                </div>
                <Input
                  id="qos-target"
                  value={form.target}
                  onChange={(e) => setForm({ ...form, target: e.target.value })}
                  placeholder="IP/MAC/servicio"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="qos-priority">Prioridad</Label>
                  <HelpHint content={PRIORITY_HELP} label="¿Qué es la prioridad?" />
                </div>
                <select
                  id="qos-priority"
                  value={form.priority}
                  onChange={(e) => setForm({ ...form, priority: e.target.value as QosPriority })}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {PRIORITY_LABEL[p]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="qos-down">↓ kbps (0=∞)</Label>
                  <HelpHint content={KBPS_HELP} label="¿Qué son los kbps?" />
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
                <Label htmlFor="qos-up">↑ kbps (0=∞)</Label>
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
                  <th className="px-3 py-2 text-left">Objetivo</th>
                  <th className="px-3 py-2 text-left">Prioridad</th>
                  <th className="px-3 py-2 text-left">↓</th>
                  <th className="px-3 py-2 text-left">↑</th>
                  {isAdmin && <th className="px-3 py-2 text-right">Acción</th>}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <SkeletonRows cols={isAdmin ? 7 : 6} />
                ) : rules.length === 0 ? (
                  <tr>
                    <td colSpan={isAdmin ? 7 : 6} className="px-3 py-8 text-center">
                      <p className="text-kr-muted">Aún no hay reglas de QoS.</p>
                      <p className="mx-auto mt-1 max-w-md text-kr-xs text-kr-secondary">
                        La QoS reparte tu conexión para que lo importante no se resienta.{' '}
                        {isAdmin &&
                          'Crea una regla arriba para, por ejemplo, dar prioridad a las videollamadas o limitar una descarga.'}
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
                          errorMessage={`No se pudo actualizar ${r.name}`}
                          aria-label={`Activar regla ${r.name}`}
                        />
                      </td>
                      <td className="px-3 py-2">{r.name}</td>
                      <td className="px-3 py-2 font-mono text-xs">{r.target}</td>
                      <td className={`px-3 py-2 ${PRIORITY_CLASS[r.priority]}`}>
                        {PRIORITY_LABEL[r.priority]}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{formatLimit(r.downloadKbps)}</td>
                      <td className="px-3 py-2 font-mono text-xs">{formatLimit(r.uploadKbps)}</td>
                      {isAdmin && (
                        <td className="px-3 py-2 text-right">
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
    </div>
  );
}
