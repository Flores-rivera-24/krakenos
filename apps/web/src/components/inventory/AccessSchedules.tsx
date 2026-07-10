import type { AccessSchedule } from '@krakenos/types';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  DAY_LABELS,
  createSchedule,
  deleteSchedule,
  hhmmToMinutes,
  listSchedules,
  minutesToHHMM,
  updateSchedule,
} from '@/lib/access';
import { describeError } from '@/lib/errors';
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
      setError(describeError(err, 'No se pudieron cargar los horarios'));
    }
  };
  useEffect(() => {
    void load();
  }, [mac]);

  const toggleDay = (d: number) =>
    setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort((a, b) => a - b)));

  const submit = async () => {
    if (days.length === 0) {
      toast.error('Elige al menos un día');
      return;
    }
    setBusy(true);
    try {
      await createSchedule({
        name: name.trim() || 'Sin internet',
        mac,
        days,
        startMinute: hhmmToMinutes(start),
        endMinute: hhmmToMinutes(end),
      });
      toast.success('Horario creado');
      setName('');
      setAdding(false);
      setDays(DEFAULT_DAYS);
      setStart('21:00');
      setEnd('07:00');
      await load();
    } catch (err) {
      toast.error(describeError(err, 'No se pudo crear el horario'));
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (s: AccessSchedule) => {
    try {
      await updateSchedule(s.id, { enabled: !s.enabled });
      await load();
    } catch (err) {
      toast.error(describeError(err, 'No se pudo cambiar el horario'));
    }
  };

  const remove = async (s: AccessSchedule) => {
    try {
      await deleteSchedule(s.id);
      await load();
    } catch (err) {
      toast.error(describeError(err, 'No se pudo eliminar el horario'));
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-kr-sm font-medium text-kr-primary">Control parental · horarios</h3>
        {canEdit && !adding && (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            Añadir horario
          </Button>
        )}
      </div>
      <p className="text-kr-xs text-kr-muted">
        Corta el acceso a internet de este dispositivo en las ventanas que definas (p. ej.
        21:00–07:00 de lunes a viernes).
      </p>

      {error && <p className="text-kr-sm text-danger">{error}</p>}

      {schedules && schedules.length === 0 && !adding && (
        <p className="text-kr-sm text-kr-secondary">
          Sin horarios: este dispositivo no tiene cortes programados.
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
                {(Array.isArray(s.days) ? s.days : []).map((d) => DAY_LABELS[d]).join(' ')}
              </p>
            </div>
            {canEdit && (
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
          </li>
        ))}
      </ul>

      {adding && canEdit && (
        <div className="space-y-3 rounded-md border border-kr bg-kr-surface p-3">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nombre (p. ej. Hora de dormir)"
            maxLength={60}
          />
          <div className="flex gap-1">
            {DAY_LABELS.map((label, d) => (
              <button
                key={d}
                type="button"
                onClick={() => toggleDay(d)}
                aria-pressed={days.includes(d)}
                aria-label={`Día ${label}`}
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
            <span>De</span>
            <Input
              type="time"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="w-28"
              aria-label="Hora de inicio"
            />
            <span>a</span>
            <Input
              type="time"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className="w-28"
              aria-label="Hora de fin"
            />
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void submit()} disabled={busy}>
              {busy ? 'Guardando…' : 'Guardar'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
