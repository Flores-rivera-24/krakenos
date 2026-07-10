import type { UpdateWifiRequest, WifiBand, WifiNetwork, WifiSecurity } from '@krakenos/types';
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

const BANDS: WifiBand[] = ['2.4GHz', '5GHz', '6GHz'];
const SECURITIES: WifiSecurity[] = ['open', 'wpa2', 'wpa3', 'wpa2/wpa3'];
const SELECT_CLASS =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';

interface Props {
  network: WifiNetwork;
  isAdmin: boolean;
  onUpdated: (w: WifiNetwork) => void;
}

export function MainNetworkCard({ network, isAdmin, onUpdated }: Props) {
  const t = useT();
  const [ssid, setSsid] = useState(network.ssid);
  const [password, setPassword] = useState('');
  const [band, setBand] = useState<WifiBand>(network.band);
  const [security, setSecurity] = useState<WifiSecurity>(network.security);
  const [hidden, setHidden] = useState(network.hidden);
  const [enabled, setEnabled] = useState(network.enabled);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  const save = async () => {
    setSaving(true);
    setFeedback(null);
    const body: UpdateWifiRequest = {
      ssid,
      band,
      security,
      hidden,
      enabled,
      ...(password ? { password } : {}),
    };
    try {
      const updated = await api.put<WifiNetwork>('/wifi', body);
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
        <CardTitle className="text-base text-foreground">{t('wifi.main.title')}</CardTitle>
        <Switch
          checked={enabled}
          onCheckedChange={setEnabled}
          disabled={!isAdmin}
          aria-label={t('wifi.main.enableAria')}
        />
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <Label htmlFor="ssid">{t('wifi.ssid')}</Label>
            <GlossaryHint termKey="ssid" />
          </div>
          <Input
            id="ssid"
            value={ssid}
            onChange={(e) => setSsid(e.target.value)}
            disabled={!isAdmin}
            maxLength={32}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">{t('wifi.password')}</Label>
          <Input
            id="password"
            type="password"
            value={password}
            placeholder={t('wifi.passwordPlaceholder')}
            onChange={(e) => setPassword(e.target.value)}
            disabled={!isAdmin || security === 'open'}
            minLength={8}
            maxLength={63}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="band">{t('wifi.band')}</Label>
              <GlossaryHint termKey="banda-24-5-6" />
            </div>
            <select
              id="band"
              className={SELECT_CLASS}
              value={band}
              onChange={(e) => setBand(e.target.value as WifiBand)}
              disabled={!isAdmin}
            >
              {BANDS.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="security">{t('wifi.security')}</Label>
              <HelpHint content={t('wifi.securityHelp')} label={t('wifi.securityLabel')} />
            </div>
            <select
              id="security"
              className={SELECT_CLASS}
              value={security}
              onChange={(e) => setSecurity(e.target.value as WifiSecurity)}
              disabled={!isAdmin}
            >
              {SECURITIES.map((s) => (
                <option key={s} value={s}>
                  {s === 'open' ? t('wifi.securityOpen') : s.toUpperCase()}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <Label htmlFor="hidden">{t('wifi.hiddenSsid')}</Label>
            <HelpHint content={t('wifi.hiddenHelp')} label={t('wifi.hiddenLabel')} />
          </span>
          <Switch id="hidden" checked={hidden} onCheckedChange={setHidden} disabled={!isAdmin} />
        </div>

        {feedback && (
          <p className={feedback.ok ? 'text-sm text-success' : 'text-sm text-danger'}>
            {feedback.msg}
          </p>
        )}

        {isAdmin && (
          <Button onClick={() => void save()} disabled={saving} className="w-full">
            {saving ? t('common.saving') : t('common.saveChanges')}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
