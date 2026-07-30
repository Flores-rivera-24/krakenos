import type { PersonSummary } from '@krakenos/types';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Input } from '@/components/ui/input';
import { Slideover } from '@/components/ui/slideover';
import { Switch } from '@/components/ui/switch';
import { DAY_LABELS, hhmmToMinutes, minutesToHHMM } from '@/lib/access';
import { describeError } from '@/lib/errors';
import { useT } from '@/lib/i18n';
import { setBedtime } from '@/lib/people';
import { cn } from '@/lib/utils';
import { toast } from '@/store/toast.store';

interface Props {
  person: PersonSummary;
  onClose: () => void;
  onSaved: () => void;
}

/** Lunes a viernes: el caso por defecto del control parental de un día de colegio. */
const DEFAULT_DAYS = [1, 2, 3, 4, 5];

/**
 * Editor de la «hora de dormir» de una persona (US-240). Una sola ventana que el
 * servidor replica a todos sus dispositivos — los horarios finos por aparato
 * siguen viviendo en el detalle del dispositivo.
 */
export function BedtimeSlideover({ person, onClose, onSaved }: Props) {
  const t = useT();
  const bedtime = person.bedtime;
  const [days, setDays] = useState<number[]>(bedtime ? [...bedtime.days] : DEFAULT_DAYS);
  const [start, setStart] = useState(minutesToHHMM(bedtime?.startMinute ?? 22 * 60));
  const [end, setEnd] = useState(minutesToHHMM(bedtime?.endMinute ?? 7 * 60));
  const [enabled, setEnabled] = useState(bedtime?.enabled ?? true);
  const [busy, setBusy] = useState(false);

  const toggleDay = (d: number) =>
    setDays((cur) =>
      cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort((a, b) => a - b),
    );

  const submit = async () => {
    if (days.length === 0) {
      toast.error(t('people.bedtime.noDays'));
      return;
    }
    setBusy(true);
    try {
      await setBedtime(person.userId!, {
        days,
        startMinute: hhmmToMinutes(start),
        endMinute: hhmmToMinutes(end),
        enabled,
      });
      toast.success(t('people.bedtime.saved'));
      onSaved();
      onClose();
    } catch (err) {
      toast.error(describeError(err, t('people.bedtime.saveError')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Slideover open onClose={onClose} title={t('people.bedtime.title', { name: person.name })}>
      <div className="space-y-4">
        <p className="text-kr-sm text-kr-secondary">{t('people.bedtime.desc')}</p>

        {/* Sin dispositivos no hay nada que cortar: decirlo antes de guardar, no después. */}
        {person.devices.length === 0 && (
          <Callout variant="warning" standing>
            {t('people.bedtime.noDevices')}
          </Callout>
        )}

        <div className="space-y-2">
          <p className="text-kr-sm font-medium text-kr-primary">{t('people.bedtime.days')}</p>
          <div className="flex flex-wrap gap-1">
            {DAY_LABELS.map((label, d) => (
              <button
                key={d}
                type="button"
                onClick={() => toggleDay(d)}
                aria-pressed={days.includes(d)}
                aria-label={t('people.bedtime.dayAria', { label })}
                className={cn(
                  'h-9 w-9 rounded-md border text-kr-sm',
                  days.includes(d)
                    ? 'border-kr-accent bg-kr-accent text-white'
                    : 'border-kr text-kr-secondary hover:bg-kr-elevated',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-kr-sm text-kr-secondary">
          <span>{t('people.bedtime.from')}</span>
          <Input
            type="time"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="w-28"
            aria-label={t('people.bedtime.from')}
          />
          <span>{t('people.bedtime.to')}</span>
          <Input
            type="time"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className="w-28"
            aria-label={t('people.bedtime.to')}
          />
        </div>

        <div className="flex items-center gap-2">
          <Switch
            checked={enabled}
            onCheckedChange={setEnabled}
            aria-label={t('people.bedtime.enabled')}
          />
          <span className="text-kr-sm text-kr-secondary">{t('people.bedtime.enabled')}</span>
        </div>

        <div className="flex gap-2 pt-2">
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? t('people.saving') : t('people.save')}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t('people.cancel')}
          </Button>
        </div>
      </div>
    </Slideover>
  );
}
