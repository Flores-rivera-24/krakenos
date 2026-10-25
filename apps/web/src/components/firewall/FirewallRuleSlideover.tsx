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
import { FormError } from '@/components/ui/form-error';
import { ApiRequestError, api } from '@/lib/api';
import { useT, type TranslationKey } from '@/lib/i18n';
import '@/lib/i18n/catalog/fragments/firewall';

const SELECT_CLASS =
  'h-10 w-full rounded-md border border-kr-field bg-kr-elevated px-3 text-kr-base text-kr-primary';
const PROTOCOLS: FirewallProtocol[] = ['any', 'tcp', 'udp'];
// Etiquetas visibles (el valor de la API no cambia); alineadas con FirewallPage.
// Guardan la CLAVE, no el texto: una constante de módulo con el copy ya resuelto
// se congelaría con el idioma que hubiera al importar el módulo. TCP y UDP son
// siglas de protocolo y no se traducen.
const ACTION_LABEL_KEY: Record<FirewallAction, TranslationKey> = {
  deny: 'firewall.action.deny',
  allow: 'firewall.action.allow',
};
const PROTOCOL_LABEL_KEY: Record<FirewallProtocol, TranslationKey | null> = {
  any: 'firewall.protocol.any',
  tcp: null,
  udp: null,
};

interface Props {
  rule: FirewallRule;
  /** Solo los admin pueden guardar; un viewer ve el panel en modo lectura. */
  canEdit: boolean;
  onClose: () => void;
  /** Se llama tras guardar para recargar la lista. */
  onSaved: () => void;
}

export function FirewallRuleSlideover({ rule, canEdit, onClose, onSaved }: Props) {
  const t = useT();
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
      setError(err instanceof ApiRequestError ? err.body.message : t('common.saveError'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Slideover
      open
      onClose={onClose}
      title={t('firewall.ruleTitle', { name: rule.name })}
      subtitle={t('firewall.rulePriority', { priority: rule.priority })}
      footer={
        canEdit && (
          <div className="space-y-2">
            {error && <FormError>{error}</FormError>}
            <Button onClick={() => void save()} disabled={saving} className="w-full">
              {saving ? t('common.saving') : t('common.saveChanges')}
            </Button>
          </div>
        )
      }
    >
      <fieldset disabled={!canEdit} className="space-y-4">
        <div className="flex items-center justify-between">
          <Label htmlFor="fr-enabled">{t('firewall.col.active')}</Label>
          <Switch id="fr-enabled" checked={enabled} onCheckedChange={setEnabled} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="fr-name">{t('firewall.name')}</Label>
          <Input
            id="fr-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="fr-action">{t('firewall.action')}</Label>
            <select
              id="fr-action"
              className={SELECT_CLASS}
              value={action}
              onChange={(e) => setAction(e.target.value as FirewallAction)}
            >
              <option value="deny">{t(ACTION_LABEL_KEY.deny)}</option>
              <option value="allow">{t(ACTION_LABEL_KEY.allow)}</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="fr-protocol">{t('firewall.protocol')}</Label>
            <select
              id="fr-protocol"
              className={SELECT_CLASS}
              value={protocol}
              onChange={(e) => setProtocol(e.target.value as FirewallProtocol)}
            >
              {PROTOCOLS.map((p) => {
                const key = PROTOCOL_LABEL_KEY[p];
                return (
                  <option key={p} value={p}>
                    {key ? t(key) : p.toUpperCase()}
                  </option>
                );
              })}
            </select>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="fr-source">{t('firewall.source')}</Label>
          <Input
            id="fr-source"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder={t('firewall.sourcePlaceholder')}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="fr-dest">{t('firewall.dest')}</Label>
          <Input
            id="fr-dest"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            placeholder={t('firewall.destPlaceholder')}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="fr-port">{t('firewall.port')}</Label>
          <Input
            id="fr-port"
            value={portText}
            onChange={(e) => setPortText(e.target.value.replace(/\D/g, ''))}
            placeholder={t('firewall.portPlaceholder')}
            inputMode="numeric"
          />
        </div>
      </fieldset>
    </Slideover>
  );
}
