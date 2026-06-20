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
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof CreateTuyaDeviceRequest, v: string) => setForm({ ...form, [k]: v });

  return (
    <div className="grid gap-3 rounded-md border border-kr bg-kr-elevated p-3 sm:grid-cols-2">
      <div className="space-y-1">
        <Label htmlFor="tf-name" className="text-kr-xs">Nombre</Label>
        <Input id="tf-name" value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={80} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="tf-ip" className="text-kr-xs">IP</Label>
        <Input id="tf-ip" value={form.ip} onChange={(e) => set('ip', e.target.value)} placeholder="192.168.1.x" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="tf-deviceId" className="text-kr-xs">Device ID</Label>
        <Input
          id="tf-deviceId"
          value={form.deviceId}
          onChange={(e) => set('deviceId', e.target.value)}
          disabled={initial.deviceId !== ''}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="tf-localKey" className="text-kr-xs">Local Key</Label>
        <Input
          id="tf-localKey"
          type="password"
          value={form.localKey}
          onChange={(e) => set('localKey', e.target.value)}
          placeholder={initial.deviceId ? 'sin cambios' : ''}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="tf-version" className="text-kr-xs">Versión</Label>
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
          {busy ? 'Guardando…' : submitLabel}
        </Button>
        <Button variant="outline" size="sm" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

/** Gestión inline de los focos Tuya (alta/edición/borrado). Solo admin. */
export function TuyaManager({ reachable }: Props) {
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
      setError(err instanceof ApiRequestError ? err.body.message : 'Operación fallida');
    }
  };

  return (
    <div className="space-y-3">
      {error && <p className="text-kr-sm text-danger">{error}</p>}

      <div className="overflow-hidden rounded-md border border-kr">
        <table className="w-full text-kr-sm">
          <thead className="bg-kr-elevated text-kr-secondary">
            <tr>
              <th className="px-3 py-2 text-left">Estado</th>
              <th className="px-3 py-2 text-left">Nombre</th>
              <th className="px-3 py-2 text-left">IP</th>
              <th className="px-3 py-2 text-left">Device ID</th>
              <th className="px-3 py-2 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {devices?.map((d) => (
              <tr key={d.deviceId} className="border-t border-kr align-top">
                {editingId === d.deviceId ? (
                  <td colSpan={5} className="p-3">
                    <FocoForm
                      initial={{ ...EMPTY, deviceId: d.deviceId, ip: d.ip, name: d.name, version: d.version }}
                      submitLabel="Guardar"
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
                          <span className="text-kr-xs text-kr-secondary">¿Eliminar?</span>
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
                            Sí
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setDeletingId(null)}>
                            No
                          </Button>
                        </span>
                      ) : (
                        <span className="inline-flex gap-1">
                          <Button variant="ghost" size="sm" onClick={() => setEditingId(d.deviceId)}>
                            Editar
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setDeletingId(d.deviceId)}>
                            Eliminar
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
                  Sin focos Tuya registrados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {adding ? (
        <FocoForm
          initial={EMPTY}
          submitLabel="Añadir foco"
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
          Añadir foco
        </Button>
      )}
    </div>
  );
}
