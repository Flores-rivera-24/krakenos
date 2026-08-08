import type { AccessSchedule } from '@krakenos/types';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { FormError } from '@/components/ui/form-error';
import {
  diasIniciales,
  createSchedule,
  deleteSchedule,
  hhmmToMinutes,
  listSchedules,
  minutesToHHMM,
  updateSchedule,
} from '@/lib/access';
import { describeError } from '@/lib/errors';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { toast } from '@/store/toast.store';

interface Props {
  mac: string;
  canEdit: boolean;
}

const DEFAULT_DAYS = [1, 2, 3, 4, 5]; // lunes a viernes

/**
 * Control parental / horarios de acceso de un dispositivo (US-108). Corta el
 * internet del dispositivo en ventanas recurrentes. Solo `admin` edita.
 */
export function AccessSchedules({ mac, canEdit }: Props) {
  const t = useT();
  const [schedules, setSchedules] = useState<AccessSchedule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [days, setDays] = useState<number[]>(DEFAULT_DAYS);
  const [start, setStart] = useState('21:00');
  const [end, setEnd] = useState('07:00');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setError(null);
    try {
      setSchedules(await listSchedules(mac));
    } catch (err) {
      setError(describeError(err, t('access.loadError')));
    }
  };
  useEffect(() => {
    void load();
  }, [mac]);

  const toggleDay = (d: number) =>
    setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort((a, b) => a - b)));

  const submit = async () => {
    if (days.length === 0) {
      toast.error(t('access.pickDay'));
      return;
    }
    setBusy(true);
    try {
      await createSchedule({
        name: name.trim() || t('access.defaultName'),
        mac,
        days,
        startMinute: hhmmToMinutes(start),
        endMinute: hhmmToMinutes(end),
      });
      toast.success(t('access.created'));
      setName('');
      setAdding(false);
      setDays(DEFAULT_DAYS);
      setStart('21:00');
      setEnd('07:00');
      await load();
    } catch (err) {
      toast.error(describeError(err, t('access.createError')));
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (s: AccessSchedule) => {
    try {
      await updateSchedule(s.id, { enabled: !s.enabled });
      await load();
    } catch (err) {
      toast.error(describeError(err, t('access.toggleError')));
    }
  };

  const remove = async (s: AccessSchedule) => {
    try {
      await deleteSchedule(s.id);
      await load();
    } catch (err) {
      toast.error(describeError(err, t('access.deleteError')));
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-kr-sm font-medium text-kr-primary">{t('access.title')}</h3>
        {canEdit && !adding && (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            {t('access.add')}
          </Button>
        )}
      </div>
      <p className="text-kr-xs text-kr-muted">
        {t('access.intro')}
      </p>

      {error && <FormError>{error}</FormError>}

      {schedules && schedules.length === 0 && !adding && (
        <p className="text-kr-sm text-kr-secondary">
          {t('access.empty')}
        </p>
      )}

      <ul className="space-y-2">
        {schedules?.map((s) => (
          <li
            key={s.id}
            className="flex items-center gap-2 rounded-md border border-kr bg-kr-elevated px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-kr-sm text-kr-primary">{s.name}</p>
              <p className="text-kr-xs text-kr-muted">
                {minutesToHHMM(s.startMinute)}–{minutesToHHMM(s.endMinute)} ·{' '}
                {(Array.isArray(s.days) ? s.days : []).map((d) => diasIniciales(t)[d]).join(' ')}
                {/* US-240: un horario de persona se gobierna desde Personas y el
                    servidor lo replica a todos sus aparatos. Editarlo aquí lo
                    dejaría descuadrado con el resto sin avisar, así que se marca y
                    no se toca desde el dispositivo. */}
                {s.personId && ` · ${t('access.byPerson')}`}
              </p>
            </div>
            {canEdit && !s.personId && (
              <>
                <Switch
                  checked={s.enabled}
                  onCheckedChange={() => void toggle(s)}
                  aria-label={`Activar ${s.name}`}
                />
                <button
                  type="button"
                  onClick={() => void remove(s)}
                  aria-label={`Eliminar ${s.name}`}
                  className="px-1 text-kr-secondary hover:text-danger"
                >
                  ✕
                </button>
              </>
            )}
            {s.personId && (
              <Link to="/people" className="text-kr-xs text-kr-accent hover:underline">
                {t('nav.people')}
              </Link>
            )}
          </li>
        ))}
      </ul>

      {adding && canEdit && (
        <div className="space-y-3 rounded-md border border-kr bg-kr-surface p-3">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('access.namePlaceholder')}
            maxLength={60}
          />
          <div className="flex gap-1">
            {diasIniciales(t).map((label, d) => (
              <button
                key={d}
                type="button"
                onClick={() => toggleDay(d)}
                aria-pressed={days.includes(d)}
                aria-label={t('access.day', { day: label })}
                className={cn(
                  'h-8 w-8 rounded-md border text-kr-sm',
                  days.includes(d)
                    ? 'border-kr-accent bg-kr-accent text-white'
                    : 'border-kr text-kr-secondary hover:bg-kr-elevated',
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 text-kr-sm text-kr-secondary">
            <span>{t('access.from')}</span>
            <Input
              type="time"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="w-28"
              aria-label={t('access.startTime')}
            />
            <span>{t('access.to')}</span>
            <Input
              type="time"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className="w-28"
              aria-label={t('access.endTime')}
            />
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void submit()} disabled={busy}>
              {busy ? t('common.saving') : t('common.save')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
