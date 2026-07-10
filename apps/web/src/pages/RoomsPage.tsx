import type { CreateRoomRequest, RoomIcon, RoomWithState } from '@krakenos/types';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DeleteButton } from '@/components/ui/delete-button';
import { ErrorBanner } from '@/components/ui/error-banner';
import { FavoriteButton } from '@/components/ui/favorite-button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Slideover } from '@/components/ui/slideover';
import {
  ROOM_ICONS,
  createRoom,
  deleteRoom,
  listRooms,
  roomGlyph,
  runRoomAction,
  updateRoom,
} from '@/lib/rooms';
import { describeError } from '@/lib/errors';
import { plural, useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { canControlHome } from '@/lib/roles';
import { useAuthStore } from '@/store/auth.store';
import { useFavoritesStore } from '@/store/favorites.store';
import { toast } from '@/store/toast.store';

/** Tarjeta táctil de una habitación con estado agregado + acción de grupo (US-165). */
function RoomTile({
  room,
  isAdmin,
  canControl,
  onEdit,
  onReload,
}: {
  room: RoomWithState;
  isAdmin: boolean;
  /** Operar la habitación (acción de grupo) también para `member` (US-179). */
  canControl: boolean;
  onEdit: () => void;
  onReload: () => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const allOn = room.controllableCount > 0 && room.onCount === room.controllableCount;

  const runAction = async (on: boolean) => {
    setBusy(true);
    try {
      const result = await runRoomAction(room.id, { on });
      if (result.failed.length > 0) {
        toast.error(
          t('rooms.actionPartial', { applied: result.applied, failed: result.failed.length }),
        );
      } else {
        toast.success(on ? t('rooms.turnedOn') : t('rooms.turnedOff'));
      }
      onReload();
    } catch (err) {
      toast.error(describeError(err, t('rooms.actionError')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="flex flex-col">
      <CardContent className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between">
          <button
            type="button"
            onClick={onEdit}
            disabled={!isAdmin}
            className="flex items-center gap-3 text-left disabled:cursor-default"
          >
            <span
              aria-hidden
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-kr-muted bg-kr-elevated text-2xl"
            >
              {roomGlyph(room.icon)}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-kr-base font-medium text-kr-primary">
                {room.name}
              </span>
              <span className="block text-kr-xs text-kr-muted">
                {room.deviceCount}{' '}
                {plural(room.deviceCount, {
                  one: t('rooms.device.one'),
                  other: t('rooms.device.other'),
                })}{' '}
                ·{' '}
                {room.iotCount} IoT
                {room.anyUnreachable && <span className="text-warning">{t('rooms.noSignal')}</span>}
              </span>
            </span>
          </button>
          <FavoriteButton kind="room" ref_={room.id} label={room.name} />
        </div>

        {room.controllableCount > 0 ? (
          <p className="text-kr-sm text-kr-secondary">
            {t('rooms.onCount', { on: room.onCount, total: room.controllableCount })}
          </p>
        ) : (
          <p className="text-kr-sm text-kr-muted">{t('rooms.noControllable')}</p>
        )}

        {canControl && room.controllableCount > 0 && (
          <div className="mt-auto flex gap-2">
            <Button
              variant={allOn ? 'default' : 'outline'}
              className="flex-1"
              disabled={busy}
              onClick={() => void runAction(true)}
            >
              {t('rooms.turnOn')}
            </Button>
            <Button
              variant="outline"
              className="flex-1"
              disabled={busy}
              onClick={() => void runAction(false)}
            >
              {t('rooms.turnOff')}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Panel de alta/edición de una habitación (US-165). */
function RoomEditor({
  room,
  onClose,
  onSaved,
}: {
  room: RoomWithState | 'new';
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const editing = room !== 'new';
  const [name, setName] = useState(editing ? room.name : '');
  const [icon, setIcon] = useState<RoomIcon>(editing ? room.icon : 'living');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const trimmed = name.trim();
    if (trimmed === '') {
      setError(t('rooms.nameRequired'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (editing) {
        await updateRoom(room.id, { name: trimmed, icon });
        toast.success(t('rooms.updated'));
      } else {
        const body: CreateRoomRequest = { name: trimmed, icon };
        await createRoom(body);
        toast.success(t('rooms.created'));
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(describeError(err, t('rooms.saveError')));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!editing) return;
    try {
      await deleteRoom(room.id);
      toast.success(t('rooms.deleted'));
      onSaved();
      onClose();
    } catch (err) {
      toast.error(describeError(err, t('rooms.deleteError')));
    }
  };

  return (
    <Slideover
      open
      onClose={onClose}
      title={editing ? t('rooms.editTitle') : t('rooms.newTitle')}
      footer={
        <div className="space-y-2">
          {error && <p className="text-kr-sm text-danger">{error}</p>}
          <Button onClick={() => void save()} disabled={saving} className="w-full">
            {saving ? t('rooms.saving') : t('rooms.save')}
          </Button>
          {editing && (
            <DeleteButton onDelete={remove} variant="destructive" className="w-full">
              {t('rooms.deleteRoom')}
            </DeleteButton>
          )}
        </div>
      }
    >
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="room-name">{t('rooms.name')}</Label>
          <Input
            id="room-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('rooms.namePlaceholder')}
            maxLength={60}
          />
        </div>
        <div className="space-y-2">
          <Label>{t('rooms.icon')}</Label>
          <div className="grid grid-cols-5 gap-2">
            {ROOM_ICONS.map((opt) => (
              <button
                key={opt.icon}
                type="button"
                title={t(`rooms.icon.${opt.icon}`)}
                aria-label={t(`rooms.icon.${opt.icon}`)}
                aria-pressed={icon === opt.icon}
                onClick={() => setIcon(opt.icon)}
                className={cn(
                  'flex h-12 items-center justify-center rounded-lg border text-2xl transition-colors',
                  icon === opt.icon
                    ? 'border-kr-accent bg-kr-accent-faint'
                    : 'border-kr bg-kr-elevated hover:border-kr-muted',
                )}
              >
                {opt.glyph}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Slideover>
  );
}

export function RoomsPage() {
  const t = useT();
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin');
  const canControl = useAuthStore((s) => canControlHome(s.user?.role));
  const [rooms, setRooms] = useState<RoomWithState[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<RoomWithState | 'new' | null>(null);

  const reload = useCallback(() => {
    void listRooms()
      .then((list) => {
        setRooms(list);
        setError(null);
      })
      .catch((err) => {
        // Sin esto la rama `=== null` dejaba el Skeleton brillando para siempre (AUD-13).
        setRooms((prev) => prev ?? []);
        setError(describeError(err, t('rooms.loadError')));
      });
  }, []);

  useEffect(() => {
    reload();
    // Favoritos para que la estrella de cada habitación refleje el estado real (US-170).
    void useFavoritesStore.getState().load();
  }, [reload]);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">{t('rooms.title')}</h2>
          <p className="text-sm text-muted-foreground">{t('rooms.subtitle')}</p>
        </div>
        {isAdmin && (
          <Button onClick={() => setEditor('new')}>{t('rooms.newTitle')}</Button>
        )}
      </div>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      {rooms === null ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full rounded-xl" />
          ))}
        </div>
      ) : rooms.length === 0 ? (
        !error && (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-kr bg-kr-surface py-16 text-center">
            <p className="text-kr-secondary">{t('rooms.empty.title')}</p>
            <p className="mx-auto max-w-md text-kr-sm text-kr-muted">{t('rooms.empty.desc')}</p>
            {isAdmin ? (
              <Button onClick={() => setEditor('new')}>{t('rooms.empty.cta')}</Button>
            ) : (
              <Link to="/iot" className={buttonVariants({ variant: 'outline' })}>
                {t('rooms.empty.viewIot')}
              </Link>
            )}
          </div>
        )
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rooms.map((room) => (
            <RoomTile
              key={room.id}
              room={room}
              isAdmin={isAdmin}
              canControl={canControl}
              onEdit={() => setEditor(room)}
              onReload={reload}
            />
          ))}
        </div>
      )}

      {editor && (
        <RoomEditor room={editor} onClose={() => setEditor(null)} onSaved={reload} />
      )}
    </div>
  );
}
