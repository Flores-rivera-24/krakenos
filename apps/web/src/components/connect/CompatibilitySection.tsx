import type { CompatCategory, CompatibilityEntry } from '@krakenos/types';
import { COMPAT_CATEGORIES } from '@krakenos/types';
import { CheckCircle2, CircleDot, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  ETIQUETA_DE_CAPACIDAD,
  ETIQUETA_DE_CATEGORIA,
  ETIQUETA_DE_DEPENDENCIA,
  ETIQUETA_DE_REQUISITO,
  NOMBRE_DE_FICHA,
  etiquetaCompat,
  listCompatibility,
} from '@/lib/compatibility';
import { formatDate } from '@/lib/format';
import { useT } from '@/lib/i18n';
import '@/lib/i18n/catalog/fragments/conectar';

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

  // El agente manda el id; el nombre sale del catálogo (traducido) y por él se
  // busca y se ordena. Un id que esta versión no conoce se declara. Sin `useMemo`
  // a propósito: `t` es una función estable y un memo no se recalcularía al cambiar
  // de idioma (son ~22 fichas; recalcular en cada render no cuesta nada).
  const nombres = new Map(entries.map((e) => [e.id, etiquetaCompat(NOMBRE_DE_FICHA, e.id, t)]));
  const nombre = (id: string) => nombres.get(id) ?? id;
  const q = query.trim().toLowerCase();
  const filtered = entries
    .filter(
      (e) =>
        (category === 'all' || e.category === category) &&
        (q === '' || nombre(e.id).toLowerCase().includes(q)),
    )
    .sort((a, b) => nombre(a.id).localeCompare(nombre(b.id)));

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-kr-lg font-semibold text-kr-primary">{t('compat.title')}</h2>
        <p className="text-kr-sm text-kr-muted">{t('compat.subtitle')}</p>
      </div>

      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-kr-muted"
          aria-hidden
        />
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
            {etiquetaCompat(ETIQUETA_DE_CATEGORIA, c, t)}
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
                <span className="font-medium text-kr-primary">{nombre(e.id)}</span>
                {/* US-258: la verificación es una FECHA, no un sí/no. «Verificado»
                    sin cuándo envejece mal: una prueba de hace dos años sobre un
                    firmware que ya no existe se lee igual que una de ayer. */}
                <span
                  className={cn(
                    'flex items-center gap-1 text-kr-xs',
                    e.verifiedAt ? 'text-success' : 'text-kr-muted',
                  )}
                >
                  {e.verifiedAt ? (
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                  ) : (
                    <CircleDot className="h-3.5 w-3.5" aria-hidden />
                  )}
                  {e.verifiedAt
                    ? t('compat.verifiedOn', {
                        date: formatDate(e.verifiedAt),
                      })
                    : t('compat.unverified')}
                </span>
              </div>
              <div className="flex flex-wrap gap-1">
                {e.capabilities.map((c) => (
                  <Badge key={c}>{etiquetaCompat(ETIQUETA_DE_CAPACIDAD, c, t)}</Badge>
                ))}
              </div>
              {/* US-238: solo se marca lo `community`. Poner también un sello a lo
                  `core` convertiría la distinción en decoración — lo que hay que
                  ver de un vistazo es qué NO lleva garantía. */}
              {e.support === 'community' && (
                <p className="text-kr-xs text-warning">{t('compat.community')}</p>
              )}
              {/* US-258: línea APARTE del sello de arriba, y no dentro de él, porque
                  son dos cosas distintas: aquello es el compromiso de mantenimiento
                  y esto es lo que vas a tener que hacer. Kasa es `core` —se
                  mantiene— y aun así los Tapo piden la cuenta del fabricante; con
                  una sola línea, ese caso no tenía dónde decirse. */}
              {e.appDependency && (
                <p className="text-kr-xs text-warning">
                  {etiquetaCompat(ETIQUETA_DE_DEPENDENCIA, e.appDependency.reason, t)}
                  {e.appDependency.scope === 'some' && e.appDependency.devices ? (
                    <> {t('compat.app.only', { devices: e.appDependency.devices })}</>
                  ) : null}
                </p>
              )}
              {e.requirements.length > 0 && (
                <p className="text-kr-xs text-kr-muted">
                  {t('compat.needs')}{' '}
                  {e.requirements
                    .map((r) => etiquetaCompat(ETIQUETA_DE_REQUISITO, r, t))
                    .join(' · ')}
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
