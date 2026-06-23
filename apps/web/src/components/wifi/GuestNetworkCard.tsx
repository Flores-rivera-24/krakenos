import type { GuestNetwork, UpdateGuestNetworkRequest } from '@krakenos/types';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ApiRequestError, api } from '@/lib/api';

interface Props {
  network: GuestNetwork;
  isAdmin: boolean;
  onUpdated: (g: GuestNetwork) => void;
}

export function GuestNetworkCard({ network, isAdmin, onUpdated }: Props) {
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
        <CardTitle className="text-base text-foreground">Red de invitados</CardTitle>
        <Switch
          checked={enabled}
          onCheckedChange={setEnabled}
          disabled={!isAdmin}
          aria-label="Activar red de invitados"
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
          <Label htmlFor="guest-password">Contraseña</Label>
          <Input
            id="guest-password"
            type="password"
            value={password}
            placeholder="••••••••  (dejar vacío para no cambiar)"
            onChange={(e) => setPassword(e.target.value)}
            disabled={!isAdmin}
            minLength={8}
            maxLength={63}
          />
        </div>

        <div className="flex items-center justify-between">
          <Label htmlFor="isolation">Aislar clientes entre sí</Label>
          <Switch
            id="isolation"
            checked={clientIsolation}
            onCheckedChange={setClientIsolation}
            disabled={!isAdmin}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="limit">Límite de ancho de banda (Mbps)</Label>
          <Input
            id="limit"
            type="number"
            min={1}
            max={10000}
            value={limit}
            placeholder="Sin límite"
            onChange={(e) => setLimit(e.target.value)}
            disabled={!isAdmin}
          />
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
