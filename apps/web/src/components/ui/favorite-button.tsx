import type { FavoriteKind } from '@krakenos/types';
import { Star } from 'lucide-react';
import { useState } from 'react';
import { describeError } from '@/lib/errors';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { useFavoritesStore } from '@/store/favorites.store';
import { toast } from '@/store/toast.store';

interface Props {
  kind: FavoriteKind;
  ref_: string;
  /** Nombre legible del objetivo, para el toast y la etiqueta accesible. */
  label: string;
  className?: string;
}

/**
 * Botón de estrella para fijar/quitar un favorito (US-170). Optimista con
 * reversión implícita: si la mutación falla, el store no cambia y se avisa por
 * toast. Reusa el patrón de feedback de US-96.
 */
export function FavoriteButton({ kind, ref_, label, className }: Props) {
  const t = useT();
  const isFav = useFavoritesStore((s) => s.isFavorite(kind, ref_));
  const toggle = useFavoritesStore((s) => s.toggle);
  const [busy, setBusy] = useState(false);

  const onClick = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const now = await toggle(kind, ref_);
      toast.success(
        now ? t('ui.favorite.pinned', { label }) : t('ui.favorite.unpinned', { label }),
      );
    } catch (err) {
      toast.error(describeError(err, t('ui.favorite.error')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void onClick();
      }}
      disabled={busy}
      aria-pressed={isFav}
      aria-label={isFav ? t('ui.favorite.unpin', { label }) : t('ui.favorite.pin', { label })}
      title={isFav ? t('ui.favorite.unpinTitle') : t('ui.favorite.pinTitle')}
      className={cn(
        'inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors disabled:opacity-50',
        isFav ? 'text-kr-accent' : 'text-kr-muted hover:text-kr-secondary',
        className,
      )}
    >
      <Star className="h-5 w-5" fill={isFav ? 'currentColor' : 'none'} aria-hidden />
    </button>
  );
}
