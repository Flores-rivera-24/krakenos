import type { UpdateWifiRequest, WifiBand, WifiNetwork, WifiSecurity } from '@krakenos/types';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ApiRequestError, api } from '@/lib/api';

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
      setFeedback({ ok: true, msg: 'Cambios guardados' });
    } catch (err) {
      const msg = err instanceof ApiRequestError ? err.body.message : 'No se pudo guardar';
      setFeedback({ ok: false, msg });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base text-foreground">Red principal</CardTitle>
        <Switch
          checked={enabled}
          onCheckedChange={setEnabled}
          disabled={!isAdmin}
          aria-label="Activar red principal"
        />
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="ssid">SSID</Label>
          <Input
            id="ssid"
            value={ssid}
            onChange={(e) => setSsid(e.target.value)}
            disabled={!isAdmin}
            maxLength={32}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Contraseña</Label>
          <Input
            id="password"
            type="password"
            value={password}
            placeholder="••••••••  (dejar vacío para no cambiar)"
            onChange={(e) => setPassword(e.target.value)}
            disabled={!isAdmin || security === 'open'}
            minLength={8}
            maxLength={63}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="band">Banda</Label>
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
            <Label htmlFor="security">Seguridad</Label>
            <select
              id="security"
              className={SELECT_CLASS}
              value={security}
              onChange={(e) => setSecurity(e.target.value as WifiSecurity)}
              disabled={!isAdmin}
            >
              {SECURITIES.map((s) => (
                <option key={s} value={s}>
                  {s.toUpperCase()}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <Label htmlFor="hidden">SSID oculto</Label>
          <Switch id="hidden" checked={hidden} onCheckedChange={setHidden} disabled={!isAdmin} />
        </div>

        {feedback && (
          <p className={feedback.ok ? 'text-sm text-green-500' : 'text-sm text-destructive'}>
            {feedback.msg}
          </p>
        )}

        {isAdmin && (
          <Button onClick={() => void save()} disabled={saving} className="w-full">
            {saving ? 'Guardando…' : 'Guardar cambios'}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
