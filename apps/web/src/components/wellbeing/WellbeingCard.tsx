import type { PersonUsage, WellbeingRange } from '@krakenos/types';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatBytes } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { WELLBEING_RANGES, fetchWellbeingUsage } from '@/lib/wellbeing';

/**
 * Bienestar digital (US-184): uso de internet por persona. El servidor filtra por
 * rol (un admin ve el hogar; el resto solo lo suyo), así que aquí solo se pinta
 * lo recibido. Se muestra junto al tráfico de red (misma naturaleza que US-46).
 */
export function WellbeingCard() {
  const t = useT();
  const [range, setRange] = useState<WellbeingRange>('week');
  const [people, setPeople] = useState<PersonUsage[] | null>(null);

  useEffect(() => {
    let active = true;
    setPeople(null);
    void fetchWellbeingUsage(range)
      .then((u) => active && setPeople(Array.isArray(u?.people) ? u.people : []))
      .catch(() => active && setPeople([]));
    return () => {
      active = false;
    };
  }, [range]);

  const max = people && people.length > 0 ? Math.max(...people.map((p) => p.totalBytes), 1) : 1;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>{t('wellbeing.title')}</CardTitle>
        <div className="flex gap-1" role="group" aria-label={t('wellbeing.rangeLabel')}>
          {WELLBEING_RANGES.map((r) => (
            <button
              key={r.value}
              type="button"
              onClick={() => setRange(r.value)}
              aria-pressed={range === r.value}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                range === r.value
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-xs text-muted-foreground">{t('wellbeing.subtitle')}</p>
        {people === null ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{t('wellbeing.loading')}</p>
        ) : people.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{t('wellbeing.empty')}</p>
        ) : (
          <ul className="space-y-3">
            {people.map((p) => (
              <li key={p.userId ?? 'unassigned'} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-foreground">
                    {p.userId === null ? t('wellbeing.unassigned') : p.name}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {t('wellbeing.devices', { n: p.deviceCount })}
                    </span>
                  </span>
                  <span className="tabular-nums text-muted-foreground">{formatBytes(p.totalBytes)}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${Math.max(2, (p.totalBytes / max) * 100)}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
