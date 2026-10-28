import { Radio } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { WidgetError } from '@/components/ui/widget-error';
import { StatusDot } from '@/components/ui/status-dot';
import { describeError } from '@/lib/errors';
import { getMqttState, updateMqtt, type MqttState } from '@/lib/interop';
import { useT } from '@/lib/i18n';
import { useLectura } from '@/lib/use-lectura';
import { toast } from '@/store/toast.store';
import '@/lib/i18n/catalog/fragments/ajustes';

/**
 * Publicación MQTT saliente (US-174), admin. Publica el estado del hogar a un
 * broker MQTT local para integrar con Home Assistant/Node-RED. La contraseña se
 * guarda cifrada y nunca se devuelve (el campo se deja en blanco para conservarla).
 */
export function MqttInteropCard() {
  const t = useT();
  const [state, setState] = useState<MqttState | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [url, setUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [prefix, setPrefix] = useState('krakenos');
  const [interval, setIntervalSec] = useState('30');
  const [discovery, setDiscovery] = useState(false);
  const [control, setControl] = useState(false);
  const [pauseControl, setPauseControl] = useState(false);
  const [saving, setSaving] = useState(false);

  const lectura = useLectura(getMqttState, []);
  const { data: leido } = lectura;
  // Una respuesta sin `config` no es un formulario vacío: es una lectura fallida.
  const noCargado = lectura.failed || (!lectura.loading && !leido?.config);
  // El render que ya tiene el dato aún no tiene los campos rellenados (lo hace el efecto).
  const [hidratado, setHidratado] = useState<MqttState | null>(null);
  const bloqueado = lectura.loading || noCargado || hidratado !== leido;

  useEffect(() => {
    if (!leido?.config) return;
    setState(leido);
    setEnabled(leido.config.enabled);
    setUrl(leido.config.url);
    setUsername(leido.config.username);
    setPrefix(leido.config.topicPrefix);
    setIntervalSec(String(leido.config.intervalSec));
    setDiscovery(leido.config.discovery);
    setControl(leido.config.control);
    setPauseControl(leido.config.pauseControl);
    setHidratado(leido);
  }, [leido]);

  const save = async () => {
    setSaving(true);
    try {
      const next = await updateMqtt({
        enabled,
        url,
        username,
        // Vacío = conservar la guardada; no la borramos desde aquí.
        ...(password ? { password } : {}),
        topicPrefix: prefix,
        intervalSec: Number(interval),
        discovery,
        control,
        pauseControl,
      });
      setState(next);
      setPassword('');
      toast.success(t('settings.mqtt.saved'));
    } catch (err) {
      toast.error(describeError(err, t('settings.mqtt.error')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Radio className="h-4 w-4 text-kr-accent" aria-hidden />
          {t('settings.mqtt.title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-kr-xs text-kr-muted">{t('settings.mqtt.desc')}</p>

        {noCargado && (
          <WidgetError message={t('settings.mqtt.loadError')} onRetry={lectura.reintentar} />
        )}

        <label className="flex items-center gap-2 text-kr-sm text-kr-secondary">
          <input
            type="checkbox"
            disabled={bloqueado}
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          {t('settings.mqtt.enabled')}
        </label>

        <div className="space-y-2">
          <Label htmlFor="mqtt-url">{t('settings.mqtt.url')}</Label>
          <Input
            id="mqtt-url"
            disabled={bloqueado}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="mqtt://192.168.1.10:1883"
          />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="mqtt-user">{t('settings.mqtt.username')}</Label>
            <Input
              id="mqtt-user"
              disabled={bloqueado}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="mqtt-pass">{t('settings.mqtt.password')}</Label>
            <Input
              id="mqtt-pass"
              disabled={bloqueado}
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={state?.config.hasPassword ? '••••••' : ''}
            />
            <p className="text-kr-xs text-kr-muted">{t('settings.mqtt.passwordKeep')}</p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="mqtt-prefix">{t('settings.mqtt.prefix')}</Label>
            <Input
              id="mqtt-prefix"
              disabled={bloqueado}
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
              maxLength={64}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="mqtt-interval">{t('settings.mqtt.interval')}</Label>
            <Input
              id="mqtt-interval"
              disabled={bloqueado}
              type="number"
              min={5}
              max={3600}
              value={interval}
              onChange={(e) => setIntervalSec(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-2 rounded-md border border-kr p-3">
          <label className="flex items-start gap-2 text-kr-sm text-kr-secondary">
            <input
              type="checkbox"
              className="mt-0.5"
              disabled={bloqueado}
              checked={discovery}
              onChange={(e) => setDiscovery(e.target.checked)}
            />
            <span>
              {t('settings.mqtt.discovery')}
              <span className="block text-kr-xs text-kr-muted">
                {t('settings.mqtt.discoveryDesc')}
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-kr-sm text-kr-secondary">
            <input
              type="checkbox"
              className="mt-0.5"
              disabled={bloqueado}
              checked={control}
              onChange={(e) => setControl(e.target.checked)}
            />
            <span>
              {t('settings.mqtt.control')}
              <span className="block text-kr-xs text-kr-muted">
                {t('settings.mqtt.controlDesc')}
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-kr-sm text-kr-secondary">
            <input
              type="checkbox"
              className="mt-0.5"
              disabled={bloqueado}
              checked={pauseControl}
              onChange={(e) => setPauseControl(e.target.checked)}
            />
            <span>
              {t('settings.mqtt.pauseControl')}
              <span className="block text-kr-xs text-kr-muted">
                {t('settings.mqtt.pauseControlDesc')}
              </span>
            </span>
          </label>
        </div>

        {state && (
          <div className="flex items-center gap-2 text-kr-xs text-kr-muted">
            <StatusDot status={state.status.connected ? 'online' : 'offline'} />
            {state.status.connected
              ? t('settings.mqtt.connected')
              : t('settings.mqtt.disconnected')}
            {state.status.lastError && (
              <span className="text-warning">
                · {t('settings.mqtt.lastError', { error: state.status.lastError })}
              </span>
            )}
          </div>
        )}

        <Button disabled={saving || bloqueado} onClick={() => void save()}>
          {saving ? t('settings.mqtt.saving') : t('settings.mqtt.save')}
        </Button>
      </CardContent>
    </Card>
  );
}
