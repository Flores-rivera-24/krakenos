import type { MatterBridgeState } from '@krakenos/types';
import { useEffect, useState } from 'react';
import { Callout } from '@/components/ui/callout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusDot } from '@/components/ui/status-dot';
import { Switch } from '@/components/ui/switch';
import type { MatterEndpointType } from '@krakenos/types';
import { describeError } from '@/lib/errors';
import { useT, type TranslationKey } from '@/lib/i18n';
import { fetchMatterBridge, updateMatterBridge } from '@/lib/matter-bridge';
import { toast } from '@/store/toast.store';

/** Clave i18n del tipo de endpoint (evita `t()` con clave dinámica no tipada). */
const TYPE_LABEL: Record<MatterEndpointType, TranslationKey> = {
  onoff: 'matter.type.onoff',
  dimmable: 'matter.type.dimmable',
  color: 'matter.type.color',
};

interface MatterBridgeCardProps {
  isAdmin: boolean;
}

/**
 * Puente Matter (US-171): expone los dispositivos elegidos a Alexa/Google/Apple
 * como un hub Matter en la LAN. Muestra el estado y, para el admin, el interruptor
 * de opt-in, la selección de dispositivos y el QR/código de comisionado.
 */
export function MatterBridgeCard({ isAdmin }: MatterBridgeCardProps) {
  const t = useT();
  const [state, setState] = useState<MatterBridgeState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetchMatterBridge()
      .then(setState)
      .catch(() => setState(null));
  }, []);

  async function apply(patch: Parameters<typeof updateMatterBridge>[0]) {
    setBusy(true);
    try {
      setState(await updateMatterBridge(patch));
    } catch (err) {
      toast.error(describeError(err, t('matter.error')));
    } finally {
      setBusy(false);
    }
  }

  function toggleDevice(deviceId: string, exposed: boolean) {
    if (!state) return;
    const current = state.candidates.filter((c) => c.exposed).map((c) => c.deviceId);
    const next = exposed ? [...current, deviceId] : current.filter((id) => id !== deviceId);
    void apply({ exposedDeviceIds: next });
  }

  if (!state || !Array.isArray(state.candidates)) return null;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>{t('matter.title')}</CardTitle>
        <div className="flex items-center gap-2">
          <StatusDot status={state.running ? 'online' : 'offline'} />
          <span className="text-kr-xs text-kr-muted">
            {state.running
              ? state.commissioned
                ? t('matter.statusCommissioned', { n: state.fabricCount })
                : t('matter.statusWaiting')
              : t('matter.statusOff')}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-kr-sm text-kr-muted">{t('matter.subtitle')}</p>

        <div className="flex items-center justify-between">
          <span className="text-kr-sm">{t('matter.enable')}</span>
          <Switch
            checked={state.enabled}
            disabled={!isAdmin || busy}
            onCheckedChange={(v) => void apply({ enabled: v })}
            aria-label={t('matter.enable')}
          />
        </div>

        {state.enabled && (
          <>
            {/* Honestidad (US-212): el asistente marcará el hub como «no certificado». */}
            <Callout variant="warning">{t('matter.certWarning')}</Callout>

            {/* Comisionado: QR + código manual para añadirlo al asistente. */}
            {state.qrDataUrl && (
              <div className="flex flex-col items-center gap-2 rounded-md border border-kr p-4">
                <img src={state.qrDataUrl} alt={t('matter.qrAlt')} className="h-40 w-40" />
                {state.manualPairingCode && (
                  <p className="text-kr-sm">
                    {t('matter.manualCode')}:{' '}
                    <span className="font-mono">{state.manualPairingCode}</span>
                  </p>
                )}
                <p className="text-center text-kr-xs text-kr-muted">{t('matter.commissionHint')}</p>
              </div>
            )}

            <div>
              <p className="mb-2 text-kr-sm font-medium">{t('matter.devices')}</p>
              {state.candidates.length === 0 ? (
                <p className="text-kr-sm text-kr-muted">{t('matter.noDevices')}</p>
              ) : (
                <ul className="space-y-2">
                  {state.candidates.map((c) => (
                    <li key={c.deviceId} className="flex items-center justify-between text-kr-sm">
                      <span>
                        {c.name}{' '}
                        <span className="text-kr-xs text-kr-muted">
                          ({t(TYPE_LABEL[c.type])})
                        </span>
                      </span>
                      <Switch
                        checked={c.exposed}
                        disabled={!isAdmin || busy}
                        onCheckedChange={(v) => toggleDevice(c.deviceId, v)}
                        aria-label={`${t('matter.expose')} ${c.name}`}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
