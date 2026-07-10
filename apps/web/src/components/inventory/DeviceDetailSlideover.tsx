import type {
  Device,
  DeviceIcon,
  DeviceTrafficStats,
  DeviceType,
  RoomWithState,
  UpdateDeviceRequest,
  UserSummary,
  VlanWithCount,
} from '@krakenos/types';
import { DEVICE_ICONS } from '@krakenos/types';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AccessSchedules } from '@/components/inventory/AccessSchedules';
import { PauseInternet } from '@/components/inventory/PauseInternet';
import { RoomSelect } from '@/components/rooms/RoomSelect';
import { assignRoom, listRooms } from '@/lib/rooms';
import { Callout } from '@/components/ui/callout';
import { ProductArt } from '@/components/ui/product-art';
import { Slideover } from '@/components/ui/slideover';
import { Sparkline } from '@/components/ui/sparkline';
import { StatusDot } from '@/components/ui/status-dot';
import { Textarea } from '@/components/ui/textarea';
import { ApiRequestError, api } from '@/lib/api';
import { DEVICE_ICON_LABELS, DEVICE_TYPES, TYPE_LABELS, deviceArtKind } from '@/lib/devices';
import { describeError } from '@/lib/errors';
import { useT } from '@/lib/i18n';
import { listUsers } from '@/lib/users';
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
  const t = useT();
  const [label, setLabel] = useState(device.label ?? '');
  const [type, setType] = useState<DeviceType>(device.type);
  // Icono elegido a mano (US-178); null = inferido del tipo.
  const [icon, setIcon] = useState<DeviceIcon | null>(device.icon);
  const [notes, setNotes] = useState(device.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vlans, setVlans] = useState<VlanWithCount[]>([]);
  const [vlanTag, setVlanTag] = useState<number | null>(device.vlanTag);
  const [vlanBusy, setVlanBusy] = useState(false);
  const [traffic, setTraffic] = useState<DeviceTrafficStats | null>(null);
  const [rooms, setRooms] = useState<RoomWithState[]>([]);
  const [roomId, setRoomId] = useState<string | null>(device.roomId);
  const [roomBusy, setRoomBusy] = useState(false);
  // Dueño del dispositivo (US-179): base de presencia/bienestar por persona.
  const [ownerId, setOwnerId] = useState<string | null>(device.ownerId);
  const [ownerBusy, setOwnerBusy] = useState(false);
  const [householdUsers, setHouseholdUsers] = useState<UserSummary[]>([]);
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin');
  // Modo sencillo (US-176): sin campos técnicos (MAC/Fuentes) en el detalle.
  const simpleMode = useAuthStore((s) => s.user?.uiMode === 'simple');

  // Carga las VLANs disponibles para el selector (best-effort).
  useEffect(() => {
    void api
      .get<VlanWithCount[]>('/vlans')
      .then(setVlans)
      .catch(() => setVlans([]));
  }, []);

  // Habitaciones para el selector de asignación (US-165, best-effort).
  useEffect(() => {
    void listRooms()
      .then(setRooms)
      .catch(() => setRooms([]));
  }, []);

  const assignToRoom = async (next: string | null) => {
    const previous = roomId;
    setRoomId(next); // optimista
    setRoomBusy(true);
    try {
      await assignRoom({ kind: 'device', ref: device.id, roomId: next });
      toast.success(t('inventory.detail.roomUpdated'));
    } catch (err) {
      setRoomId(previous); // revertir: no mentir sobre la asignación real
      toast.error(describeError(err, t('inventory.detail.roomError')));
    } finally {
      setRoomBusy(false);
    }
  };

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
      toast.success(next ? t('inventory.detail.blocked') : t('inventory.detail.unblocked')),
    onError: (err) => toast.error(describeError(err, t('inventory.detail.blockError'))),
  });

  const assignVlan = async (tag: number | null) => {
    const previous = vlanTag;
    setVlanTag(tag); // optimista
    setVlanBusy(true);
    try {
      await api.put(`/inventory/devices/${device.id}/vlan`, { tag });
      toast.success(t('inventory.detail.vlanUpdated'));
    } catch (err) {
      setVlanTag(previous); // revertir: no mentir sobre la asignación real
      toast.error(describeError(err, t('inventory.detail.vlanError')));
    } finally {
      setVlanBusy(false);
    }
  };

  useEffect(() => {
    if (!isAdmin) return;
    void listUsers()
      .then(setHouseholdUsers)
      .catch(() => setHouseholdUsers([]));
  }, [isAdmin]);

  // Asignación de dueño con reversión (mismo patrón que habitación/VLAN).
  const assignOwner = async (next: string | null) => {
    const previous = ownerId;
    setOwnerId(next);
    setOwnerBusy(true);
    try {
      await api.patch<Device>(`/inventory/devices/${device.id}`, { ownerId: next });
      toast.success(t('inventory.detail.ownerUpdated'));
    } catch (err) {
      setOwnerId(previous);
      toast.error(describeError(err, t('inventory.detail.ownerError')));
    } finally {
      setOwnerBusy(false);
    }
  };

  // Identificación asistida (US-178): un toque clasifica el aparato desconocido.
  const identifyAs = async (nextType: DeviceType) => {
    const previous = type;
    setType(nextType);
    try {
      await api.patch<Device>(`/inventory/devices/${device.id}`, { type: nextType });
      toast.success(t('inventory.detail.identifiedAs', { type: TYPE_LABELS[nextType] }));
    } catch (err) {
      setType(previous);
      toast.error(describeError(err, t('inventory.detail.identifyError')));
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    const body: UpdateDeviceRequest = {
      label: label.trim() === '' ? null : label.trim(),
      type,
      icon,
      notes: notes.trim() === '' ? null : notes.trim(),
    };
    try {
      await api.patch<Device>(`/inventory/devices/${device.id}`, body);
      toast.success(t('inventory.detail.saved'));
      onClose();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.body.message : t('inventory.detail.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const subtitle = (
    <span className="flex items-center gap-2">
      <StatusDot status={device.online ? 'online' : 'offline'} />
      {device.online ? t('inventory.status.online') : t('inventory.status.offline')}
      {block.on && <span className="text-danger">{t('inventory.detail.blockedBadge')}</span>}
    </span>
  );

  const footer = (
    <div className="space-y-2">
      {error && <p className="text-kr-sm text-danger">{error}</p>}
      <Button onClick={() => void save()} disabled={saving} className="w-full">
        {saving ? t('common.saving') : t('common.saveChanges')}
      </Button>
      {isAdmin && (
        <Button
          variant={block.on ? 'outline' : 'destructive'}
          onClick={() => void block.toggle()}
          disabled={block.pending}
          className="w-full"
        >
          {block.pending
            ? t('inventory.detail.applying')
            : block.on
              ? t('inventory.detail.unblock')
              : t('inventory.detail.block')}
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
      {/* Render del producto: icono manual (US-178) o inferido del tipo (US-161). */}
      <div className="mb-4 flex items-center gap-4 rounded-lg border border-kr bg-kr-elevated p-4">
        <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border border-kr-muted bg-kr-surface shadow-kr-glow-sm">
          <ProductArt kind={deviceArtKind({ icon, type })} className="h-12 w-12" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-kr-base font-medium text-kr-primary">
            {device.label ?? device.hostname ?? device.mac}
          </p>
          <p className="text-kr-sm text-kr-secondary">{TYPE_LABELS[device.type]}</p>
          {device.vendor && (
            <p className="truncate text-kr-xs text-kr-muted">{device.vendor}</p>
          )}
        </div>
      </div>

      {/* Identificación asistida (US-178): la app propone, el usuario confirma. */}
      {type === 'unknown' && (
        <div className="mb-4">
          <Callout variant="info" title={t('inventory.detail.whatIsThis')}>
            <p className="mb-2">
              {device.suggestedType
                ? t('inventory.detail.suggestQuestion', {
                    type: TYPE_LABELS[device.suggestedType].toLowerCase(),
                  })
                : t('inventory.detail.notIdentified')}
            </p>
            <div className="flex flex-wrap gap-2">
              {[
                ...(device.suggestedType ? [device.suggestedType] : []),
                ...(['tv', 'phone', 'computer', 'iot'] as DeviceType[]).filter(
                  (candidate) => candidate !== device.suggestedType,
                ),
              ].map((candidate) => (
                <Button
                  key={candidate}
                  size="sm"
                  variant={candidate === device.suggestedType ? 'default' : 'outline'}
                  onClick={() => void identifyAs(candidate)}
                >
                  {candidate === device.suggestedType
                    ? t('inventory.detail.yesItIs', { type: TYPE_LABELS[candidate].toLowerCase() })
                    : TYPE_LABELS[candidate]}
                </Button>
              ))}
            </div>
          </Callout>
        </div>
      )}

      <dl className="mb-4 grid grid-cols-2 gap-3 rounded-lg border border-kr bg-kr-elevated p-3">
        <Field label={t('inventory.detail.ip')} value={device.ip} />
        {!simpleMode && <Field label={t('inventory.detail.mac')} value={device.mac} />}
        <Field label={t('inventory.detail.hostname')} value={device.hostname ?? '—'} />
        <Field label={t('inventory.detail.vendor')} value={device.vendor ?? '—'} />
        {!simpleMode && (
          <Field label={t('inventory.detail.sources')} value={device.sources.join(', ') || '—'} />
        )}
        <Field
          label={t('inventory.detail.lastSeen')}
          value={new Date(device.lastSeen).toLocaleString()}
        />
      </dl>

      {/* Histórico de tráfico de la última hora (US-46). */}
      {traffic && traffic.samples.length >= 2 ? (
        <div className="mb-4 rounded-lg border border-kr bg-kr-elevated p-3">
          <p className="mb-2 text-kr-xs text-kr-muted">{t('inventory.detail.traffic')}</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="mb-1 text-kr-xs text-kr-secondary">{t('inventory.detail.download')}</p>
              <Sparkline
                points={traffic.samples.map((s) => s.rxBytesPerSec)}
                className="w-full text-success"
              />
            </div>
            <div>
              <p className="mb-1 text-kr-xs text-kr-secondary">{t('inventory.detail.upload')}</p>
              <Sparkline points={traffic.samples.map((s) => s.txBytesPerSec)} className="w-full" />
            </div>
          </div>
        </div>
      ) : (
        <p className="mb-4 text-kr-xs text-kr-muted">{t('inventory.detail.noTraffic')}</p>
      )}

      {/* Pausa de internet (US-111) + control parental / horarios (US-108) */}
      <div className="mb-4 space-y-3 rounded-lg border border-kr bg-kr-elevated p-3">
        <PauseInternet device={device} canEdit={isAdmin} />
        <div className="border-t border-kr-muted" />
        <AccessSchedules mac={device.mac} canEdit={isAdmin} />
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="d-label">{t('inventory.detail.name')}</Label>
          <Input
            id="d-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={device.hostname ?? t('inventory.detail.noName')}
            maxLength={64}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="d-type">{t('inventory.detail.type')}</Label>
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
          <Label htmlFor="d-icon">{t('inventory.detail.icon')}</Label>
          <select
            id="d-icon"
            className={SELECT_CLASS}
            value={icon ?? ''}
            onChange={(e) => setIcon(e.target.value === '' ? null : (e.target.value as DeviceIcon))}
          >
            <option value="">{t('inventory.detail.iconAuto')}</option>
            {DEVICE_ICONS.map((k) => (
              <option key={k} value={k}>
                {DEVICE_ICON_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="d-notes">{t('inventory.detail.notes')}</Label>
          <Textarea
            id="d-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t('inventory.detail.notesPlaceholder')}
            maxLength={500}
          />
        </div>

        {isAdmin && (
          <RoomSelect
            id="d-room"
            rooms={rooms}
            value={roomId}
            disabled={roomBusy}
            onChange={(next) => void assignToRoom(next)}
          />
        )}

        {isAdmin && householdUsers.length > 0 && (
          <div className="space-y-2">
            <Label htmlFor="d-owner">{t('inventory.detail.owner')}</Label>
            <select
              id="d-owner"
              className={SELECT_CLASS}
              value={ownerId ?? ''}
              disabled={ownerBusy}
              onChange={(e) => void assignOwner(e.target.value === '' ? null : e.target.value)}
            >
              <option value="">{t('inventory.detail.noOwner')}</option>
              {householdUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.displayName}
                </option>
              ))}
            </select>
          </div>
        )}

        {isAdmin && (
          <div className="space-y-2">
            <Label htmlFor="d-vlan">{t('inventory.detail.vlan')}</Label>
            <select
              id="d-vlan"
              className={SELECT_CLASS}
              value={vlanTag ?? ''}
              disabled={vlanBusy}
              onChange={(e) => void assignVlan(e.target.value === '' ? null : Number(e.target.value))}
            >
              <option value="">{t('inventory.detail.noVlan')}</option>
              {vlans.map((v) => (
                <option key={v.id} value={v.tag}>
                  {t('inventory.detail.vlanOption', { name: v.name, tag: v.tag })}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    </Slideover>
  );
}
