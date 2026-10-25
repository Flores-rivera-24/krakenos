import type {
  Device,
  DeviceIcon,
  DeviceTrafficReport,
  DeviceTrafficStats,
  DeviceType,
  RoomWithState,
  UpdateDeviceRequest,
  UserSummary,
  VlanWithCount,
} from '@krakenos/types';
import { DEVICE_ICONS } from '@krakenos/types';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AccessKindsHelp } from '@/components/access/AccessKindsHelp';
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
import { FormError } from '@/components/ui/form-error';
import { ApiRequestError, api } from '@/lib/api';
import {
  DEVICE_ICON_LABEL_KEYS,
  DEVICE_TYPES,
  TYPE_LABEL_KEYS,
  deviceArtKind,
} from '@/lib/devices';
import { describeError } from '@/lib/errors';
import { listUsers } from '@/lib/users';
import { formatDateTime } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { useLectura } from '@/lib/use-lectura';
import { useOptimisticToggle } from '@/lib/use-optimistic-toggle';
import { useAuthStore } from '@/store/auth.store';
import { toast } from '@/store/toast.store';
import '@/lib/i18n/catalog/fragments/inventario';

const SELECT_CLASS =
  'flex h-10 w-full rounded-md border border-kr-field bg-kr-elevated px-3 py-2 text-kr-base text-kr-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-kr-ring';

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
  const [vlanTag, setVlanTag] = useState<number | null>(device.vlanTag);
  const [vlanBusy, setVlanBusy] = useState(false);
  const [roomId, setRoomId] = useState<string | null>(device.roomId);
  const [roomBusy, setRoomBusy] = useState(false);
  // Dueño del dispositivo (US-179): base de presencia/bienestar por persona.
  const [ownerId, setOwnerId] = useState<string | null>(device.ownerId);
  const [ownerBusy, setOwnerBusy] = useState(false);
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin');
  // Modo sencillo (US-176): sin campos técnicos (MAC/Fuentes) en el detalle.
  const simpleMode = useAuthStore((s) => s.user?.uiMode === 'simple');

  // Un selector cuya lista no llegó NO se ofrece vacío y editable: guardar desde ahí
  // borraría la asignación real. Se deshabilita y dice por qué.
  const lecturaVlans = useLectura(() => api.getList<VlanWithCount>('/vlans'), []);
  const lecturaRooms = useLectura<RoomWithState[]>(listRooms, []);
  const vlans = lecturaVlans.data ?? [];
  const rooms = lecturaRooms.data ?? [];

  const assignToRoom = async (next: string | null) => {
    const previous = roomId;
    setRoomId(next); // optimista
    setRoomBusy(true);
    try {
      await assignRoom({ kind: 'device', ref: device.id, roomId: next });
      toast.success(t('device.roomUpdated'));
    } catch (err) {
      setRoomId(previous); // revertir: no mentir sobre la asignación real
      toast.error(describeError(err, t('device.roomError')));
    } finally {
      setRoomBusy(false);
    }
  };

  // Histórico de tráfico de la última hora para este dispositivo (US-46). Desde
  // US-250 la fuente exige `home.activity` (solo admin), así que a los demás ni se
  // les pide: no es que no haya, es que no se les enseña. Un fallo se dice como
  // fallo, nunca como «sin datos».
  const lecturaTraffic = useLectura(
    async () => {
      const report = await api.get<DeviceTrafficReport>('/traffic/devices?range=hour');
      const found = (report?.devices ?? []).find(
        (r) => r.mac.toLowerCase() === device.mac.toLowerCase(),
      );
      return { stats: (found ?? null) as DeviceTrafficStats | null };
    },
    [device.mac],
    { enabled: isAdmin },
  );
  const traffic = lecturaTraffic.data?.stats ?? null;

  // Bloqueo optimista con reversión (US-96): el botón refleja el estado al
  // instante y vuelve atrás + toast si la petición falla; la verdad la confirma
  // luego el socket (`inventory:device-updated`).
  const block = useOptimisticToggle({
    value: device.isBlocked,
    mutate: (next) =>
      next
        ? api.post(`/inventory/devices/${device.id}/block`)
        : api.del(`/inventory/devices/${device.id}/block`),
    onSuccess: (next) => toast.success(next ? t('device.blocked') : t('device.unblocked')),
    onError: (err) => toast.error(describeError(err, t('device.blockError'))),
  });

  const assignVlan = async (tag: number | null) => {
    const previous = vlanTag;
    setVlanTag(tag); // optimista
    setVlanBusy(true);
    try {
      await api.put(`/inventory/devices/${device.id}/vlan`, { tag });
      toast.success(t('device.vlanUpdated'));
    } catch (err) {
      setVlanTag(previous); // revertir: no mentir sobre la asignación real
      toast.error(describeError(err, t('device.vlanError')));
    } finally {
      setVlanBusy(false);
    }
  };

  const lecturaUsers = useLectura<UserSummary[]>(listUsers, [], { enabled: isAdmin });
  const householdUsers = lecturaUsers.data ?? [];

  // Asignación de dueño con reversión (mismo patrón que habitación/VLAN).
  const assignOwner = async (next: string | null) => {
    const previous = ownerId;
    setOwnerId(next);
    setOwnerBusy(true);
    try {
      await api.patch<Device>(`/inventory/devices/${device.id}`, { ownerId: next });
      toast.success(t('device.ownerUpdated'));
    } catch (err) {
      setOwnerId(previous);
      toast.error(describeError(err, t('device.ownerError')));
    } finally {
      setOwnerBusy(false);
    }
  };

  // Identificación asistida (US-178): un toque clasifica el aparato desconocido.
  const identifyAs = async (tipo: DeviceType) => {
    const previous = type;
    setType(tipo);
    try {
      await api.patch<Device>(`/inventory/devices/${device.id}`, { type: tipo });
      toast.success(t('device.identifiedAs', { type: t(TYPE_LABEL_KEYS[tipo]) }));
    } catch (err) {
      setType(previous);
      toast.error(describeError(err, t('device.identifyError')));
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
      toast.success(t('device.saved'));
      onClose();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.body.message : t('common.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const subtitle = (
    <span className="flex items-center gap-2">
      <StatusDot status={device.online ? 'online' : 'offline'} />
      {device.online ? t('inventory.status.online') : t('inventory.status.offline')}
      {block.on && <span className="text-danger">· {t('inventory.status.blocked')}</span>}
    </span>
  );

  const footer = (
    <div className="space-y-2">
      {error && <FormError>{error}</FormError>}
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
            ? t('device.applying')
            : block.on
              ? t('device.unblock')
              : t('device.block')}
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
          <p className="text-kr-sm text-kr-secondary">{t(TYPE_LABEL_KEYS[device.type])}</p>
          {device.vendor && <p className="truncate text-kr-xs text-kr-muted">{device.vendor}</p>}
        </div>
      </div>

      {/* Identificación asistida (US-178): la app propone, el usuario confirma. */}
      {type === 'unknown' && (
        <div className="mb-4">
          <Callout variant="info" title={t('device.identify.title')}>
            <p className="mb-2">
              {device.suggestedType
                ? t('device.identify.guess', {
                    type: t(TYPE_LABEL_KEYS[device.suggestedType]).toLowerCase(),
                  })
                : t('device.identify.unknown')}
            </p>
            <div className="flex flex-wrap gap-2">
              {[
                ...(device.suggestedType ? [device.suggestedType] : []),
                ...(['tv', 'phone', 'computer', 'iot'] as DeviceType[]).filter(
                  (tipo) => tipo !== device.suggestedType,
                ),
              ].map((tipo) => (
                <Button
                  key={tipo}
                  size="sm"
                  variant={tipo === device.suggestedType ? 'default' : 'outline'}
                  onClick={() => void identifyAs(tipo)}
                >
                  {tipo === device.suggestedType
                    ? t('device.identify.confirm', {
                        type: t(TYPE_LABEL_KEYS[tipo]).toLowerCase(),
                      })
                    : t(TYPE_LABEL_KEYS[tipo])}
                </Button>
              ))}
            </div>
          </Callout>
        </div>
      )}

      <dl className="mb-4 grid grid-cols-2 gap-3 rounded-lg border border-kr bg-kr-elevated p-3">
        <Field label="IP" value={device.ip} />
        {!simpleMode && <Field label="MAC" value={device.mac} />}
        <Field label="Hostname" value={device.hostname ?? '—'} />
        <Field label={t('device.vendor')} value={device.vendor ?? '—'} />
        {!simpleMode && (
          <Field label={t('device.sources')} value={device.sources.join(', ') || '—'} />
        )}
        <Field label={t('device.lastSeen')} value={formatDateTime(device.lastSeen)} />
      </dl>

      {/* Histórico de tráfico de la última hora (US-46). */}
      {traffic && traffic.samples.length >= 2 ? (
        <div className="mb-4 rounded-lg border border-kr bg-kr-elevated p-3">
          <p className="mb-2 text-kr-xs text-kr-muted">{t('device.traffic.title')}</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="mb-1 text-kr-xs text-kr-secondary">{t('device.traffic.down')}</p>
              <Sparkline
                points={traffic.samples.map((s) => s.rxBytesPerSec)}
                className="w-full text-success"
              />
            </div>
            <div>
              <p className="mb-1 text-kr-xs text-kr-secondary">{t('device.traffic.up')}</p>
              <Sparkline points={traffic.samples.map((s) => s.txBytesPerSec)} className="w-full" />
            </div>
          </div>
        </div>
      ) : isAdmin && lecturaTraffic.failed ? (
        <div className="mb-4">
          <FormError>{t('device.traffic.error')}</FormError>
        </div>
      ) : isAdmin && lecturaTraffic.data ? (
        <p className="mb-4 text-kr-xs text-kr-muted">{t('device.traffic.empty')}</p>
      ) : isAdmin ? null : (
        /* «Sin datos» sería mentira: puede haberlos y no se enseñan (US-250). */
        <p className="mb-4 text-kr-xs text-kr-muted">{t('device.traffic.adminOnly')}</p>
      )}

      {/* Pausa de internet (US-111) + control parental / horarios (US-108).
          Las tres formas de cortar internet conviven aquí —pausa, horario y el
          botón de bloqueo del pie— y hasta US-240 nada decía en qué se
          diferencian: la única diferencia real es cuándo vuelve. */}
      <div className="mb-4 space-y-3 rounded-lg border border-kr bg-kr-elevated p-3">
        <AccessKindsHelp />
        <PauseInternet device={device} canEdit={isAdmin} />
        <div className="border-t border-kr-muted" />
        <AccessSchedules mac={device.mac} canEdit={isAdmin} />
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="d-label">{t('device.name')}</Label>
          <Input
            id="d-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={device.hostname ?? t('device.noName')}
            maxLength={64}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="d-type">{t('device.type')}</Label>
          <select
            id="d-type"
            className={SELECT_CLASS}
            value={type}
            onChange={(e) => setType(e.target.value as DeviceType)}
          >
            {DEVICE_TYPES.map((tipo) => (
              <option key={tipo} value={tipo}>
                {t(TYPE_LABEL_KEYS[tipo])}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="d-icon">{t('device.icon')}</Label>
          <select
            id="d-icon"
            className={SELECT_CLASS}
            value={icon ?? ''}
            onChange={(e) => setIcon(e.target.value === '' ? null : (e.target.value as DeviceIcon))}
          >
            <option value="">{t('device.iconAuto')}</option>
            {DEVICE_ICONS.map((k) => (
              <option key={k} value={k}>
                {t(DEVICE_ICON_LABEL_KEYS[k])}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="d-notes">{t('device.notes')}</Label>
          <Textarea
            id="d-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t('device.notesPlaceholder')}
            maxLength={500}
          />
        </div>

        {isAdmin && (
          <RoomSelect
            id="d-room"
            rooms={rooms}
            value={roomId}
            disabled={roomBusy || lecturaRooms.data === null}
            assignedLabel={
              lecturaRooms.data === null && roomId ? t('device.roomAssigned') : undefined
            }
            onChange={(next) => void assignToRoom(next)}
          />
        )}
        {isAdmin && lecturaRooms.failed && <FormError>{t('device.roomsLoadError')}</FormError>}

        {isAdmin && (householdUsers.length > 0 || lecturaUsers.failed) && (
          <div className="space-y-2">
            <Label htmlFor="d-owner">{t('device.owner')}</Label>
            <select
              id="d-owner"
              className={SELECT_CLASS}
              value={ownerId ?? ''}
              disabled={ownerBusy || lecturaUsers.data === null}
              onChange={(e) => void assignOwner(e.target.value === '' ? null : e.target.value)}
            >
              {lecturaUsers.data === null && ownerId ? (
                <option value={ownerId}>{t('device.ownerAssigned')}</option>
              ) : (
                <option value="">{t('device.noOwner')}</option>
              )}
              {householdUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.displayName}
                </option>
              ))}
            </select>
            {lecturaUsers.failed && <FormError>{t('device.usersLoadError')}</FormError>}
          </div>
        )}

        {isAdmin && (
          <div className="space-y-2">
            <Label htmlFor="d-vlan">VLAN</Label>
            <select
              id="d-vlan"
              className={SELECT_CLASS}
              value={vlanTag ?? ''}
              disabled={vlanBusy || lecturaVlans.data === null}
              onChange={(e) =>
                void assignVlan(e.target.value === '' ? null : Number(e.target.value))
              }
            >
              {lecturaVlans.data === null && vlanTag !== null ? (
                <option value={vlanTag}>VLAN {vlanTag}</option>
              ) : (
                <option value="">{t('device.noVlan')}</option>
              )}
              {vlans.map((v) => (
                <option key={v.id} value={v.tag}>
                  {v.name} (tag {v.tag})
                </option>
              ))}
            </select>
            {lecturaVlans.failed && <FormError>{t('device.vlansLoadError')}</FormError>}
          </div>
        )}
      </div>
    </Slideover>
  );
}
