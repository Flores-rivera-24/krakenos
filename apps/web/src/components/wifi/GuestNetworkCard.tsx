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

/** "Aislar clientes" y "límite de ancho de banda" no están en el glosario: se explican en línea. */
const ISOLATION_HELP =
  'Impide que los aparatos conectados a la red de invitados se vean entre sí. Ideal para que las visitas solo tengan internet y nada más.';
const LIMIT_HELP =
  'Velocidad máxima que puede usar la red de invitados, en Mbps (1000 Mbps = 1 Gbps). Déjalo vacío para no poner límite.';

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
        <span className="flex items-center gap-1.5">
          <CardTitle className="text-base text-foreground">Red de invitados</CardTitle>
          <GlossaryHint termKey="red-invitados" placement="bottom" />
        </span>
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
          <span className="flex items-center gap-1.5">
            <Label htmlFor="isolation">Aislar clientes entre sí</Label>
            <HelpHint content={ISOLATION_HELP} label="¿Qué es aislar clientes?" />
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
            <Label htmlFor="limit">Límite de ancho de banda (Mbps)</Label>
            <HelpHint content={LIMIT_HELP} label="¿Qué es el límite de ancho de banda?" />
          </div>
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
          <p className={feedback.ok ? 'text-sm text-success' : 'text-sm text-danger'}>
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
