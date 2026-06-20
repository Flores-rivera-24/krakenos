import type {
  FirewallAction,
  FirewallProtocol,
  FirewallRule,
  UpdateFirewallRuleRequest,
} from '@krakenos/types';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slideover } from '@/components/ui/slideover';
import { Switch } from '@/components/ui/switch';
import { ApiRequestError, api } from '@/lib/api';

const SELECT_CLASS =
  'h-10 w-full rounded-md border border-kr bg-kr-elevated px-3 text-kr-base text-kr-primary';
const PROTOCOLS: FirewallProtocol[] = ['any', 'tcp', 'udp'];

interface Props {
  rule: FirewallRule;
  /** Solo los admin pueden guardar; un viewer ve el panel en modo lectura. */
  canEdit: boolean;
  onClose: () => void;
  /** Se llama tras guardar para recargar la lista. */
  onSaved: () => void;
}

export function FirewallRuleSlideover({ rule, canEdit, onClose, onSaved }: Props) {
  const [name, setName] = useState(rule.name);
  const [action, setAction] = useState<FirewallAction>(rule.action);
  const [protocol, setProtocol] = useState<FirewallProtocol>(rule.protocol);
  const [source, setSource] = useState(rule.source ?? '');
  const [destination, setDestination] = useState(rule.destination ?? '');
  const [portText, setPortText] = useState(rule.port?.toString() ?? '');
  const [enabled, setEnabled] = useState(rule.enabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    const body: UpdateFirewallRuleRequest = {
      name: name.trim(),
      action,
      protocol,
      source: source.trim() || null,
      destination: destination.trim() || null,
      port: portText.trim() === '' ? null : Number(portText),
      enabled,
    };
    try {
      await api.patch<FirewallRule>(`/firewall/rules/${rule.id}`, body);
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.body.message : 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Slideover
      open
      onClose={onClose}
      title={`Regla: ${rule.name}`}
      subtitle={`Prioridad ${rule.priority}`}
      footer={
        canEdit && (
          <div className="space-y-2">
            {error && <p className="text-kr-sm text-danger">{error}</p>}
            <Button onClick={() => void save()} disabled={saving} className="w-full">
              {saving ? 'Guardando…' : 'Guardar cambios'}
            </Button>
          </div>
        )
      }
    >
      <fieldset disabled={!canEdit} className="space-y-4">
        <div className="flex items-center justify-between">
          <Label htmlFor="fr-enabled">Activa</Label>
          <Switch id="fr-enabled" checked={enabled} onCheckedChange={setEnabled} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="fr-name">Nombre</Label>
          <Input id="fr-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="fr-action">Acción</Label>
            <select
              id="fr-action"
              className={SELECT_CLASS}
              value={action}
              onChange={(e) => setAction(e.target.value as FirewallAction)}
            >
              <option value="deny">deny</option>
              <option value="allow">allow</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="fr-protocol">Protocolo</Label>
            <select
              id="fr-protocol"
              className={SELECT_CLASS}
              value={protocol}
              onChange={(e) => setProtocol(e.target.value as FirewallProtocol)}
            >
              {PROTOCOLS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="fr-source">Origen</Label>
          <Input
            id="fr-source"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="IP/CIDR/MAC"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="fr-dest">Destino</Label>
          <Input
            id="fr-dest"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            placeholder="IP/CIDR/host"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="fr-port">Puerto</Label>
          <Input
            id="fr-port"
            value={portText}
            onChange={(e) => setPortText(e.target.value.replace(/\D/g, ''))}
            placeholder="cualquiera"
            inputMode="numeric"
          />
        </div>
      </fieldset>
    </Slideover>
  );
}
