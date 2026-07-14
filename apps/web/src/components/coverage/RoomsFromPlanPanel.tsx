import type { ApPlacement, Wall } from '@krakenos/types';
import { DoorOpen } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { describeError } from '@/lib/errors';
import { useT } from '@/lib/i18n';
import { createRoom } from '@/lib/rooms';
import {
  apInCandidate,
  detectEnclosures,
  estimatePlanArea,
  type RoomCandidate,
} from '@/lib/rooms-from-plan';
import { toast } from '@/store/toast.store';

interface Props {
  walls: Wall[];
  accessPoints: ApPlacement[];
  widthM: number;
  heightM: number;
  canEdit: boolean;
}

/** Candidato + su nombre editable + si ya se creó. */
interface Editable {
  candidate: RoomCandidate;
  name: string;
  created: boolean;
}

/**
 * Habitaciones detectadas del plano (US-196): estima la superficie y encuentra los
 * recintos cerrados por las paredes confirmadas (US-195) como habitaciones
 * candidatas. El usuario ajusta el nombre y las crea de un toque como `Room`
 * (US-165). **Nada se crea automáticamente**; la asociación AP↔habitación es
 * informativa (`Room` no guarda geometría).
 */
export function RoomsFromPlanPanel({ walls, accessPoints, widthM, heightM, canEdit }: Props) {
  const t = useT();
  const [items, setItems] = useState<Editable[] | null>(null);
  const [creatingId, setCreatingId] = useState<number | null>(null);

  if (!canEdit) return null;

  const detect = () => {
    const candidates = detectEnclosures(walls, widthM, heightM);
    setItems(
      candidates.map((c, i) => ({
        candidate: c,
        name: t('coverage.rooms.defaultName', { n: i + 1 }),
        created: false,
      })),
    );
  };

  const create = async (index: number) => {
    const item = items?.[index];
    if (!item || !item.name.trim()) return;
    setCreatingId(index);
    try {
      await createRoom({ name: item.name.trim() });
      setItems((prev) => prev?.map((it, i) => (i === index ? { ...it, created: true } : it)) ?? null);
      toast.success(t('coverage.rooms.created', { name: item.name.trim() }));
    } catch (err) {
      toast.error(describeError(err, t('coverage.rooms.error')));
    } finally {
      setCreatingId(null);
    }
  };

  const setName = (index: number, name: string) =>
    setItems((prev) => prev?.map((it, i) => (i === index ? { ...it, name } : it)) ?? null);

  return (
    <div className="rounded-xl border border-kr bg-kr-surface p-4 text-kr-sm">
      <p className="mb-1 flex items-center gap-2 font-medium text-kr-primary">
        <DoorOpen className="h-4 w-4" aria-hidden />
        {t('coverage.rooms.title')}
      </p>
      <p className="text-kr-xs text-kr-muted">{t('coverage.rooms.hint')}</p>
      <p className="mt-2 text-kr-secondary">
        {t('coverage.rooms.area', { area: estimatePlanArea(widthM, heightM) })}
      </p>

      <div className="mt-3 space-y-3">
        {walls.length === 0 ? (
          <p className="text-kr-xs text-kr-muted">{t('coverage.rooms.needWalls')}</p>
        ) : items == null ? (
          <Button size="sm" onClick={detect}>
            {t('coverage.rooms.detect')}
          </Button>
        ) : items.length === 0 ? (
          <p className="text-kr-secondary">{t('coverage.rooms.none')}</p>
        ) : (
          <>
            <p className="text-kr-secondary">{t('coverage.rooms.found', { count: items.length })}</p>
            <ul className="space-y-2">
              {items.map((it, i) => {
                const apCount = accessPoints.filter((ap) => apInCandidate(ap, it.candidate)).length;
                return (
                  <li key={i} className="space-y-1 rounded-md border border-kr bg-kr-elevated p-2">
                    <div className="flex items-center gap-2 text-kr-xs text-kr-muted">
                      <span>{t('coverage.rooms.roomArea', { area: it.candidate.areaM2 })}</span>
                      {apCount > 0 && <span>· {t('coverage.rooms.aps', { count: apCount })}</span>}
                    </div>
                    <div className="flex gap-2">
                      <Input
                        aria-label={t('coverage.rooms.namePlaceholder')}
                        value={it.name}
                        disabled={it.created}
                        onChange={(e) => setName(i, e.target.value)}
                        maxLength={64}
                      />
                      <Button
                        size="sm"
                        disabled={it.created || creatingId === i || !it.name.trim()}
                        onClick={() => void create(i)}
                      >
                        {it.created
                          ? '✓'
                          : creatingId === i
                            ? t('coverage.rooms.creating')
                            : t('coverage.rooms.create')}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
