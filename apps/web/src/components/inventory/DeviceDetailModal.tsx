import type { Device, DeviceType, UpdateDeviceRequest } from '@krakenos/types';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ApiRequestError, api } from '@/lib/api';
import { DEVICE_TYPES, TYPE_LABELS } from '@/lib/devices';

const SELECT_CLASS =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

interface Props {
  device: Device;
  onClose: () => void;
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-mono text-sm">{value}</dd>
    </div>
  );
}

export function DeviceDetailModal({ device, onClose }: Props) {
  const [label, setLabel] = useState(device.label ?? '');
  const [type, setType] = useState<DeviceType>(device.type);
  const [notes, setNotes] = useState(device.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    const body: UpdateDeviceRequest = {
      label: label.trim() === '' ? null : label.trim(),
      type,
      notes: notes.trim() === '' ? null : notes.trim(),
    };
    try {
      // El agente emite inventory:device-updated → el store se actualiza solo.
      await api.patch<Device>(`/inventory/devices/${device.id}`, body);
      onClose();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.body.message : 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onClose={onClose}>
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h3 className="text-lg font-semibold">{device.label ?? device.hostname ?? device.mac}</h3>
          <p className={device.online ? 'text-xs text-green-500' : 'text-xs text-muted-foreground'}>
            {device.online ? 'online' : 'offline'}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cerrar
        </Button>
      </div>

      <dl className="mb-4 grid grid-cols-2 gap-3 rounded-md bg-secondary/40 p-3">
        <Field label="IP" value={device.ip} />
        <Field label="MAC" value={device.mac} />
        <Field label="Hostname" value={device.hostname ?? '—'} />
        <Field label="Fabricante" value={device.vendor ?? '—'} />
        <Field label="Fuentes" value={device.sources.join(', ') || '—'} />
        <Field label="Última vez" value={new Date(device.lastSeen).toLocaleString()} />
      </dl>

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

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button onClick={() => void save()} disabled={saving} className="w-full">
          {saving ? 'Guardando…' : 'Guardar cambios'}
        </Button>
      </div>
    </Dialog>
  );
}
