import type { CreateTuyaDeviceRequest, TuyaDeviceView, TuyaProtocolVersion } from '@krakenos/types';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { DeleteButton } from '@/components/ui/delete-button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { StatusDot } from '@/components/ui/status-dot';
import { StaleBadge } from '@/components/ui/stale-badge';
import { WidgetError } from '@/components/ui/widget-error';
import { useLectura } from '@/lib/use-lectura';
import { FormError } from '@/components/ui/form-error';
import { ApiRequestError, api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { invalidarIot, trasEscribir } from '@/lib/resources';
import '@/lib/i18n/catalog/fragments/ajustes';
import '@/lib/i18n/catalog/fragments/usuarios';

const VERSIONS: TuyaProtocolVersion[] = ['3.1', '3.3', '3.4', '3.5'];
const EMPTY: CreateTuyaDeviceRequest = {
  deviceId: '',
  localKey: '',
  ip: '',
  name: '',
  version: '3.3',
};

interface Props {
  /** Device IDs Tuya alcanzables (derivados de /iot/devices) para el dot de estado. */
  reachable: Set<string>;
}

function FocoForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: CreateTuyaDeviceRequest;
  submitLabel: string;
  onSubmit: (v: CreateTuyaDeviceRequest) => Promise<void>;
  onCancel: () => void;
}) {
  const t = useT();
  const uid = useId();
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof CreateTuyaDeviceRequest, v: string) => setForm({ ...form, [k]: v });

  return (
    <div className="grid gap-3 rounded-md border border-kr bg-kr-elevated p-3 sm:grid-cols-2">
      <div className="space-y-1">
        <Label htmlFor={`${uid}-name`} className="text-kr-xs">
          {t('tuya.name')}
        </Label>
        <Input
          id={`${uid}-name`}
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          maxLength={80}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${uid}-ip`} className="text-kr-xs">
          IP
        </Label>
        <Input
          id={`${uid}-ip`}
          value={form.ip}
          onChange={(e) => set('ip', e.target.value)}
          placeholder="192.168.1.x"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${uid}-deviceId`} className="text-kr-xs">
          Device ID
        </Label>
        <Input
          id={`${uid}-deviceId`}
          value={form.deviceId}
          onChange={(e) => set('deviceId', e.target.value)}
          disabled={initial.deviceId !== ''}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${uid}-localKey`} className="text-kr-xs">
          Local Key
        </Label>
        <Input
          id={`${uid}-localKey`}
          type="password"
          autoComplete="new-password"
          value={form.localKey}
          onChange={(e) => set('localKey', e.target.value)}
          placeholder={initial.deviceId ? t('tuya.unchanged') : ''}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${uid}-version`} className="text-kr-xs">
          {t('tuya.version')}
        </Label>
        <Select
          id={`${uid}-version`}
          value={form.version}
          onChange={(e) => set('version', e.target.value)}
          disabled={initial.deviceId !== ''}
        >
          {VERSIONS.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex items-end gap-2">
        <Button
          size="sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onSubmit(form);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? t('common.saving') : submitLabel}
        </Button>
        <Button variant="outline" size="sm" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
      </div>
    </div>
  );
}

/** Gestión inline de los focos Tuya (alta/edición/borrado). Solo admin. */
export function TuyaManager({ reachable }: Props) {
  const t = useT();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const lectura = useLectura(() => api.getList<TuyaDeviceView>('/iot/tuya/devices'), []);
  const devices = lectura.data;
  const load = lectura.reintentar;

  const handle = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
      load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.body.message : t('tuya.opError'));
    }
  };

  return (
    <div className="space-y-3">
      {error && <FormError>{error}</FormError>}
      {lectura.failed && devices !== null && <StaleBadge />}

      <div className="overflow-x-auto rounded-md border border-kr">
        <table className="w-full text-kr-sm">
          <thead className="bg-kr-elevated text-kr-secondary">
            <tr>
              <th className="px-3 py-2 text-left">{t('tuya.col.status')}</th>
              <th className="px-3 py-2 text-left">{t('tuya.name')}</th>
              <th className="px-3 py-2 text-left">IP</th>
              <th className="px-3 py-2 text-left">Device ID</th>
              <th className="px-3 py-2 text-right">{t('users.col.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {devices?.map((d) => (
              <tr key={d.deviceId} className="border-t border-kr align-top">
                {editingId === d.deviceId ? (
                  <td colSpan={5} className="p-3">
                    <FocoForm
                      initial={{
                        ...EMPTY,
                        deviceId: d.deviceId,
                        ip: d.ip,
                        name: d.name,
                        version: d.version,
                      }}
                      submitLabel={t('common.save')}
                      onCancel={() => setEditingId(null)}
                      onSubmit={(v) =>
                        handle(async () => {
                          await trasEscribir(
                            api.patch(`/iot/tuya/devices/${d.deviceId}`, {
                              ip: v.ip,
                              name: v.name,
                              ...(v.localKey ? { localKey: v.localKey } : {}),
                            }),
                            invalidarIot,
                          );
                          setEditingId(null);
                        })
                      }
                    />
                  </td>
                ) : (
                  <>
                    <td className="px-3 py-2">
                      <StatusDot status={reachable.has(d.deviceId) ? 'online' : 'offline'} />
                    </td>
                    <td className="px-3 py-2 text-kr-primary">{d.name}</td>
                    <td className="px-3 py-2 font-mono text-kr-xs">{d.ip}</td>
                    <td className="px-3 py-2 font-mono text-kr-xs text-kr-muted">
                      {d.deviceId.slice(0, 8)}…
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span className="inline-flex gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setEditingId(d.deviceId)}>
                          {t('common.edit')}
                        </Button>
                        <DeleteButton
                          onDelete={() =>
                            handle(async () => {
                              await trasEscribir(
                                api.del(`/iot/tuya/devices/${d.deviceId}`),
                                invalidarIot,
                              );
                            })
                          }
                        >
                          {t('common.delete')}
                        </DeleteButton>
                      </span>
                    </td>
                  </>
                )}
              </tr>
            ))}
            {lectura.failed && devices === null && (
              <tr>
                <td colSpan={5}>
                  <WidgetError message={t('tuya.loadError')} onRetry={lectura.reintentar} />
                </td>
              </tr>
            )}
            {devices?.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-kr-muted">
                  {t('tuya.empty')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {adding ? (
        <FocoForm
          initial={EMPTY}
          submitLabel={t('tuya.add')}
          onCancel={() => setAdding(false)}
          onSubmit={(v) =>
            handle(async () => {
              await trasEscribir(api.post('/iot/tuya/devices', v), invalidarIot);
              setAdding(false);
            })
          }
        />
      ) : (
        <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
          {t('tuya.add')}
        </Button>
      )}
    </div>
  );
}
