import type { UpdateWifiRequest, WifiBand, WifiNetwork, WifiSecurity } from '@krakenos/types';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { GlossaryHint } from '@/components/ui/glossary-hint';
import { HelpHint } from '@/components/ui/help-hint';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ApiRequestError, api } from '@/lib/api';

/** Explicación llana de WPA2 vs WPA3 (no hay una única clave de glosario para "seguridad"). */
const SECURITY_HELP =
  'El candado que protege tu WiFi con contraseña. WPA3 es lo más seguro; WPA2 es compatible con aparatos antiguos; el modo mixto WPA2/WPA3 acepta ambos.';

/** "Red oculta" no está en el glosario: se explica en línea. */
const HIDDEN_HELP =
  'Si la activas, tu red no aparece en la lista de WiFi y hay que escribir el nombre a mano para conectarse. No la hace más segura, solo menos visible.';

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

  // Qué está a punto de cortar la red. Se nombra en el aviso para que sea concreto
  // («al cambiar el nombre de la red») en vez de un genérico.
  const motivos: string[] = [];
  if (ssid !== network.ssid) motivos.push('el nombre de la red (SSID)');
  if (password.length > 0) motivos.push('la contraseña');
  if (security !== network.security) motivos.push('el tipo de seguridad');
  const cambioQueDesconecta =
    motivos.length === 0
      ? null
      : motivos.length === 1
        ? motivos[0]
        : `${motivos.slice(0, -1).join(', ')} y ${motivos[motivos.length - 1]}`;

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
          <div className="flex items-center gap-1.5">
            <Label htmlFor="ssid">SSID</Label>
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
          <Label htmlFor="password">Contraseña</Label>
          <Input
            id="password"
            type="password"
            value={password}
            placeholder="•••••••• (dejar vacío para no cambiar)"
            onChange={(e) => setPassword(e.target.value)}
            disabled={!isAdmin || security === 'open'}
            minLength={8}
            maxLength={63}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="band">Banda</Label>
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
              <Label htmlFor="security">Seguridad</Label>
              <HelpHint content={SECURITY_HELP} label="¿Qué es la seguridad WiFi?" />
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
                  {s === 'open' ? 'Abierta (sin contraseña)' : s.toUpperCase()}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <Label htmlFor="hidden">SSID oculto</Label>
            <HelpHint content={HIDDEN_HELP} label="¿Qué es un SSID oculto?" />
          </span>
          <Switch id="hidden" checked={hidden} onCheckedChange={setHidden} disabled={!isAdmin} />
        </div>

        {feedback && (
          <p className={feedback.ok ? 'text-sm text-success' : 'text-sm text-danger'}>
            {feedback.msg}
          </p>
        )}

        {/* US-235 (AUD3-29): cambiar el SSID o la contraseña **desconecta la casa
            entera** —incluido el móvil desde el que se está haciendo— y la app no
            lo mencionaba en ningún sitio (0 coincidencias de «se desconectará» o
            «reconectar» fuera de las guías). El aviso aparece solo cuando de
            verdad hay un cambio que corta la red, no en cada visita. */}
        {isAdmin && cambioQueDesconecta && (
          <Callout variant="warning" title="Esto desconectará todos tus dispositivos">
            Al cambiar {cambioQueDesconecta}, todo lo conectado a esta red se cae y hay que volver
            a conectarlo con los datos nuevos — incluido el teléfono o el portátil desde el que
            estás ahora. Si entras por WiFi, perderás el acceso hasta reconectar.
          </Callout>
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
