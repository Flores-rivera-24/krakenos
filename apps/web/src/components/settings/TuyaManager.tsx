import type {
  CreateTuyaDeviceRequest,
  TuyaDeviceView,
  TuyaProtocolVersion,
} from '@krakenos/types';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusDot } from '@/components/ui/status-dot';
import { ApiRequestError, api } from '@/lib/api';
import { useT } from '@/lib/i18n';

const VERSIONS: TuyaProtocolVersion[] = ['3.1', '3.3', '3.4'];
const EMPTY: CreateTuyaDeviceRequest = { deviceId: '', localKey: '', ip: '', name: '', version: '3.3' };

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
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof CreateTuyaDeviceRequest, v: string) => setForm({ ...form, [k]: v });

  return (
    <div className="grid gap-3 rounded-md border border-kr bg-kr-elevated p-3 sm:grid-cols-2">
      <div className="space-y-1">
        <Label htmlFor="tf-name" className="text-kr-xs">{t('settings.tuya.name')}</Label>
        <Input id="tf-name" value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={80} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="tf-ip" className="text-kr-xs">{t('settings.tuya.ip')}</Label>
        <Input id="tf-ip" value={form.ip} onChange={(e) => set('ip', e.target.value)} placeholder="192.168.1.x" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="tf-deviceId" className="text-kr-xs">{t('settings.tuya.deviceId')}</Label>
        <Input
          id="tf-deviceId"
          value={form.deviceId}
          onChange={(e) => set('deviceId', e.target.value)}
          disabled={initial.deviceId !== ''}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="tf-localKey" className="text-kr-xs">{t('settings.tuya.localKey')}</Label>
        <Input
          id="tf-localKey"
          type="password"
          value={form.localKey}
          onChange={(e) => set('localKey', e.target.value)}
          placeholder={initial.deviceId ? t('settings.tuya.unchanged') : ''}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="tf-version" className="text-kr-xs">{t('settings.tuya.version')}</Label>
        <select
          id="tf-version"
          value={form.version}
          onChange={(e) => set('version', e.target.value)}
          className="h-10 w-full rounded-md border border-kr bg-kr-surface px-3 text-kr-base text-kr-primary"
        >
          {VERSIONS.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
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
  const [devices, setDevices] = useState<TuyaDeviceView[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    void api
      .get<TuyaDeviceView[]>('/iot/tuya/devices')
      .then(setDevices)
      .catch(() => setDevices([]));

  useEffect(load, []);

  const handle = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
      load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.body.message : t('settings.tuya.opError'));
    }
  };

  return (
    <div className="space-y-3">
      {error && <p className="text-kr-sm text-danger">{error}</p>}

      <div className="overflow-x-auto rounded-md border border-kr">
        <table className="w-full text-kr-sm">
          <thead className="bg-kr-elevated text-kr-secondary">
            <tr>
              <th className="px-3 py-2 text-left">{t('settings.tuya.colStatus')}</th>
              <th className="px-3 py-2 text-left">{t('settings.tuya.name')}</th>
              <th className="px-3 py-2 text-left">{t('settings.tuya.ip')}</th>
              <th className="px-3 py-2 text-left">{t('settings.tuya.deviceId')}</th>
              <th className="px-3 py-2 text-right">{t('settings.tuya.colActions')}</th>
            </tr>
          </thead>
          <tbody>
            {devices?.map((d) => (
              <tr key={d.deviceId} className="border-t border-kr align-top">
                {editingId === d.deviceId ? (
                  <td colSpan={5} className="p-3">
                    <FocoForm
                      initial={{ ...EMPTY, deviceId: d.deviceId, ip: d.ip, name: d.name, version: d.version }}
                      submitLabel={t('common.save')}
                      onCancel={() => setEditingId(null)}
                      onSubmit={(v) =>
                        handle(async () => {
                          await api.patch(`/iot/tuya/devices/${d.deviceId}`, {
                            ip: v.ip,
                            name: v.name,
                            ...(v.localKey ? { localKey: v.localKey } : {}),
                          });
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
                      {deletingId === d.deviceId ? (
                        <span className="inline-flex items-center gap-2">
                          <span className="text-kr-xs text-kr-secondary">{t('settings.tuya.deleteConfirm')}</span>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() =>
                              handle(async () => {
                                await api.del(`/iot/tuya/devices/${d.deviceId}`);
                                setDeletingId(null);
                              })
                            }
                          >
                            {t('settings.tuya.yes')}
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setDeletingId(null)}>
                            {t('settings.tuya.no')}
                          </Button>
                        </span>
                      ) : (
                        <span className="inline-flex gap-1">
                          <Button variant="ghost" size="sm" onClick={() => setEditingId(d.deviceId)}>
                            {t('settings.tuya.edit')}
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setDeletingId(d.deviceId)}>
                            {t('common.delete')}
                          </Button>
                        </span>
                      )}
                    </td>
                  </>
                )}
              </tr>
            ))}
            {devices?.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-kr-muted">
                  {t('settings.tuya.empty')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {adding ? (
        <FocoForm
          initial={EMPTY}
          submitLabel={t('settings.tuya.addBulb')}
          onCancel={() => setAdding(false)}
          onSubmit={(v) =>
            handle(async () => {
              await api.post('/iot/tuya/devices', v);
              setAdding(false);
            })
          }
        />
      ) : (
        <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
          {t('settings.tuya.addBulb')}
        </Button>
      )}
    </div>
  );
}
