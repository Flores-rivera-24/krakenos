import type { CompatCategory, CompatibilityEntry } from '@krakenos/types';
import { COMPAT_CATEGORIES } from '@krakenos/types';
import { CheckCircle2, CircleDot, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { listCompatibility } from '@/lib/compatibility';
import { useT, type TranslationKey } from '@/lib/i18n';

/**
 * Consulta de compatibilidad de hardware (US-208). Buscador + filtro por categoría
 * sobre el catálogo **derivado del código**. Honesto: distingue «verificado con
 * hardware» de «soportado por código», y avisa de que no estar en la lista no
 * implica incompatibilidad.
 */
export function CompatibilitySection() {
  const t = useT();
  const [entries, setEntries] = useState<CompatibilityEntry[]>([]);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<CompatCategory | 'all'>('all');

  useEffect(() => {
    let active = true;
    void listCompatibility()
      .then((e) => active && Array.isArray(e) && setEntries(e))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter(
      (e) =>
        (category === 'all' || e.category === category) &&
        (q === '' || e.label.toLowerCase().includes(q)),
    );
  }, [entries, query, category]);

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-kr-lg font-semibold text-kr-primary">{t('compat.title')}</h2>
        <p className="text-kr-sm text-kr-muted">{t('compat.subtitle')}</p>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-kr-muted" aria-hidden />
        <Input
          className="pl-9"
          aria-label={t('compat.search')}
          placeholder={t('compat.search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('compat.title')}>
        <FilterChip active={category === 'all'} onClick={() => setCategory('all')}>
          {t('compat.all')}
        </FilterChip>
        {COMPAT_CATEGORIES.map((c) => (
          <FilterChip key={c} active={category === c} onClick={() => setCategory(c)}>
            {t(`compat.cat.${c}` as TranslationKey)}
          </FilterChip>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-lg border border-kr bg-kr-surface p-3 text-kr-sm text-kr-muted">
          {t('compat.none')}
        </p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {filtered.map((e) => (
            <li key={e.id} className="space-y-2 rounded-lg border border-kr bg-kr-surface p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-kr-primary">{e.label}</span>
                <span
                  className={cn(
                    'flex items-center gap-1 text-kr-xs',
                    e.verified ? 'text-success' : 'text-kr-muted',
                  )}
                >
                  {e.verified ? (
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                  ) : (
                    <CircleDot className="h-3.5 w-3.5" aria-hidden />
                  )}
                  {e.verified ? t('compat.verified') : t('compat.unverified')}
                </span>
              </div>
              <div className="flex flex-wrap gap-1">
                {e.capabilities.map((c) => (
                  <Badge key={c}>{t(`compat.cap.${c}` as TranslationKey)}</Badge>
                ))}
              </div>
              {/* US-238: solo se marca lo `community`. Poner también un sello a lo
                  `core` convertiría la distinción en decoración — lo que hay que
                  ver de un vistazo es qué NO lleva garantía. */}
              {e.support === 'community' && (
                <p className="text-kr-xs text-warning">{t('compat.community')}</p>
              )}
              {e.requirements.length > 0 && (
                <p className="text-kr-xs text-kr-muted">
                  {t('compat.needs')}{' '}
                  {e.requirements.map((r) => t(`compat.req.${r}` as TranslationKey)).join(' · ')}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1 text-kr-xs transition-colors',
        active
          ? 'border-kr-accent bg-kr-accent-faint text-kr-primary'
          : 'border-kr text-kr-secondary hover:bg-kr-elevated',
      )}
    >
      {children}
    </button>
  );
}
