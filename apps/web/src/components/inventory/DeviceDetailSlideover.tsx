import type {
  Device,
  DeviceTrafficStats,
  DeviceType,
  UpdateDeviceRequest,
  VlanWithCount,
} from '@krakenos/types';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slideover } from '@/components/ui/slideover';
import { Sparkline } from '@/components/ui/sparkline';
import { StatusDot } from '@/components/ui/status-dot';
import { Textarea } from '@/components/ui/textarea';
import { ApiRequestError, api } from '@/lib/api';
import { DEVICE_TYPES, TYPE_LABELS } from '@/lib/devices';
import { describeError } from '@/lib/errors';
import { useOptimisticToggle } from '@/lib/use-optimistic-toggle';
import { useAuthStore } from '@/store/auth.store';
import { toast } from '@/store/toast.store';

const SELECT_CLASS =
  'flex h-10 w-full rounded-md border border-kr bg-kr-elevated px-3 py-2 text-kr-base text-kr-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

interface Props {
  device: Device;
  onClose: () => void;
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-kr-xs text-kr-muted">{label}</dt>
      <dd className="font-mono text-kr-sm text-kr-primary">{value}</dd>
    </div>
  );
}

export function DeviceDetailSlideover({ device, onClose }: Props) {
  const [label, setLabel] = useState(device.label ?? '');
  const [type, setType] = useState<DeviceType>(device.type);
  const [notes, setNotes] = useState(device.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vlans, setVlans] = useState<VlanWithCount[]>([]);
  const [vlanTag, setVlanTag] = useState<number | null>(device.vlanTag);
  const [vlanBusy, setVlanBusy] = useState(false);
  const [traffic, setTraffic] = useState<DeviceTrafficStats | null>(null);
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin');

  // Carga las VLANs disponibles para el selector (best-effort).
  useEffect(() => {
    void api
      .get<VlanWithCount[]>('/vlans')
      .then(setVlans)
      .catch(() => setVlans([]));
  }, []);

  // Histórico de tráfico de la última hora para este dispositivo (US-46).
  useEffect(() => {
    void api
      .get<DeviceTrafficStats[]>('/traffic/devices?range=hour')
      .then((rows) => {
        const found = rows.find((r) => r.mac.toLowerCase() === device.mac.toLowerCase());
        setTraffic(found ?? null);
      })
      .catch(() => setTraffic(null));
  }, [device.mac]);

  // Bloqueo optimista con reversión (US-96): el botón refleja el estado al
  // instante y vuelve atrás + toast si la petición falla; la verdad la confirma
  // luego el socket (`inventory:device-updated`).
  const block = useOptimisticToggle({
    value: device.isBlocked,
    mutate: (next) =>
      next
        ? api.post(`/inventory/devices/${device.id}/block`)
        : api.del(`/inventory/devices/${device.id}/block`),
    onSuccess: (next) =>
      toast.success(next ? 'Dispositivo bloqueado' : 'Acceso a la red restaurado'),
    onError: (err) => toast.error(describeError(err, 'No se pudo cambiar el bloqueo')),
  });

  const assignVlan = async (tag: number | null) => {
    const previous = vlanTag;
    setVlanTag(tag); // optimista
    setVlanBusy(true);
    try {
      await api.put(`/inventory/devices/${device.id}/vlan`, { tag });
      toast.success('VLAN actualizada');
    } catch (err) {
      setVlanTag(previous); // revertir: no mentir sobre la asignación real
      toast.error(describeError(err, 'No se pudo asignar la VLAN'));
    } finally {
      setVlanBusy(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    const body: UpdateDeviceRequest = {
      label: label.trim() === '' ? null : label.trim(),
      type,
      notes: notes.trim() === '' ? null : notes.trim(),
    };
    try {
      await api.patch<Device>(`/inventory/devices/${device.id}`, body);
      toast.success('Cambios guardados');
      onClose();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.body.message : 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  };

  const subtitle = (
    <span className="flex items-center gap-2">
      <StatusDot status={device.online ? 'online' : 'offline'} />
      {device.online ? 'online' : 'offline'}
      {block.on && <span className="text-danger">· bloqueado</span>}
    </span>
  );

  const footer = (
    <div className="space-y-2">
      {error && <p className="text-kr-sm text-danger">{error}</p>}
      <Button onClick={() => void save()} disabled={saving} className="w-full">
        {saving ? 'Guardando…' : 'Guardar cambios'}
      </Button>
      {isAdmin && (
        <Button
          variant={block.on ? 'outline' : 'destructive'}
          onClick={() => void block.toggle()}
          disabled={block.pending}
          className="w-full"
        >
          {block.pending
            ? 'Aplicando…'
            : block.on
              ? 'Desbloquear acceso a la red'
              : 'Bloquear acceso a la red'}
        </Button>
      )}
    </div>
  );

  return (
    <Slideover
      open
      onClose={onClose}
      title={device.label ?? device.hostname ?? device.mac}
      subtitle={subtitle}
      footer={footer}
    >
      <dl className="mb-4 grid grid-cols-2 gap-3 rounded-lg border border-kr bg-kr-elevated p-3">
        <Field label="IP" value={device.ip} />
        <Field label="MAC" value={device.mac} />
        <Field label="Hostname" value={device.hostname ?? '—'} />
        <Field label="Fabricante" value={device.vendor ?? '—'} />
        <Field label="Fuentes" value={device.sources.join(', ') || '—'} />
        <Field label="Última vez" value={new Date(device.lastSeen).toLocaleString()} />
      </dl>

      {/* Histórico de tráfico de la última hora (US-46). */}
      {traffic && traffic.samples.length >= 2 ? (
        <div className="mb-4 rounded-lg border border-kr bg-kr-elevated p-3">
          <p className="mb-2 text-kr-xs text-kr-muted">Tráfico (última hora)</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="mb-1 text-kr-xs text-kr-secondary">↓ Descarga</p>
              <Sparkline
                points={traffic.samples.map((s) => s.rxBytesPerSec)}
                className="w-full text-success"
              />
            </div>
            <div>
              <p className="mb-1 text-kr-xs text-kr-secondary">↑ Subida</p>
              <Sparkline points={traffic.samples.map((s) => s.txBytesPerSec)} className="w-full" />
            </div>
          </div>
        </div>
      ) : (
        <p className="mb-4 text-kr-xs text-kr-muted">Sin datos de tráfico disponibles.</p>
      )}

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="d-label">Nombre</Label>
          <Input
            id="d-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={device.hostname ?? 'Sin nombre'}
            maxLength={64}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="d-type">Tipo</Label>
          <select
            id="d-type"
            className={SELECT_CLASS}
            value={type}
            onChange={(e) => setType(e.target.value as DeviceType)}
          >
            {DEVICE_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="d-notes">Notas</Label>
          <Textarea
            id="d-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notas sobre este dispositivo…"
            maxLength={500}
          />
        </div>

        {isAdmin && (
          <div className="space-y-2">
            <Label htmlFor="d-vlan">VLAN</Label>
            <select
              id="d-vlan"
              className={SELECT_CLASS}
              value={vlanTag ?? ''}
              disabled={vlanBusy}
              onChange={(e) => void assignVlan(e.target.value === '' ? null : Number(e.target.value))}
            >
              <option value="">Sin VLAN</option>
              {vlans.map((v) => (
                <option key={v.id} value={v.tag}>
                  {v.name} (tag {v.tag})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    </Slideover>
  );
}
