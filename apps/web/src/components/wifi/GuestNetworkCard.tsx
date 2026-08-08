import type { GuestNetwork, UpdateGuestNetworkRequest } from '@krakenos/types';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { GlossaryHint } from '@/components/ui/glossary-hint';
import { HelpHint } from '@/components/ui/help-hint';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ApiRequestError, api } from '@/lib/api';
import { useT } from '@/lib/i18n';

interface Props {
  network: GuestNetwork;
  isAdmin: boolean;
  onUpdated: (g: GuestNetwork) => void;
}

export function GuestNetworkCard({ network, isAdmin, onUpdated }: Props) {
  const t = useT();
  const [ssid, setSsid] = useState(network.ssid);
  const [password, setPassword] = useState('');
  const [enabled, setEnabled] = useState(network.enabled);
  const [clientIsolation, setClientIsolation] = useState(network.clientIsolation);
  const [limit, setLimit] = useState<string>(
    network.bandwidthLimitMbps === null ? '' : String(network.bandwidthLimitMbps),
  );
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  const save = async () => {
    setSaving(true);
    setFeedback(null);
    const body: UpdateGuestNetworkRequest = {
      ssid,
      enabled,
      clientIsolation,
      bandwidthLimitMbps: limit.trim() === '' ? null : Number(limit),
      ...(password ? { password } : {}),
    };
    try {
      const updated = await api.put<GuestNetwork>('/wifi/guest', body);
      onUpdated(updated);
      setPassword('');
      setFeedback({ ok: true, msg: t('wifi.saved') });
    } catch (err) {
      const msg = err instanceof ApiRequestError ? err.body.message : t('wifi.saveError');
      setFeedback({ ok: false, msg });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <span className="flex items-center gap-1.5">
          <CardTitle className="text-base text-foreground">{t('wifi.guest.title')}</CardTitle>
          <GlossaryHint termKey="red-invitados" placement="bottom" />
        </span>
        <Switch
          checked={enabled}
          onCheckedChange={setEnabled}
          disabled={!isAdmin}
          aria-label={t('wifi.guest.enableAria')}
        />
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="guest-ssid">SSID</Label>
          <Input
            id="guest-ssid"
            value={ssid}
            onChange={(e) => setSsid(e.target.value)}
            disabled={!isAdmin}
            maxLength={32}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="guest-password">{t('users.password')}</Label>
          <Input
            id="guest-password"
            type="password"
            value={password}
            placeholder={t('wifi.passPlaceholder')}
            onChange={(e) => setPassword(e.target.value)}
            disabled={!isAdmin}
            minLength={8}
            maxLength={63}
          />
        </div>

        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <Label htmlFor="isolation">{t('wifi.isolation')}</Label>
            <HelpHint content={t('wifi.isolation.help')} label={t('wifi.isolation.helpLabel')} />
          </span>
          <Switch
            id="isolation"
            checked={clientIsolation}
            onCheckedChange={setClientIsolation}
            disabled={!isAdmin}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <Label htmlFor="limit">{t('wifi.limit')}</Label>
            <HelpHint content={t('wifi.limit.help')} label={t('wifi.limit.helpLabel')} />
          </div>
          <Input
            id="limit"
            type="number"
            min={1}
            max={10000}
            value={limit}
            placeholder={t('wifi.noLimit')}
            onChange={(e) => setLimit(e.target.value)}
            disabled={!isAdmin}
          />
        </div>

        {/* El mismo elemento acusa el éxito y el fallo, así que el rol va con
            el resultado: `alert` interrumpe —el guardado falló y hay que
            enterarse— y `status` es cortés, que es lo que merece un «hecho». */}
        {feedback && (
          <p
            role={feedback.ok ? 'status' : 'alert'}
            className={feedback.ok ? 'text-sm text-success' : 'text-sm text-danger'}
          >
            {feedback.msg}
          </p>
        )}

        {isAdmin && (
          <Button onClick={() => void save()} disabled={saving} className="w-full">
            {saving ? t('common.saving') : t('wifi.saveChanges')}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
