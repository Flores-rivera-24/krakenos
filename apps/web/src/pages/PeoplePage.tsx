import type { BlockReason, PersonSummary, UserRole } from '@krakenos/types';
import { Moon, UserRound } from 'lucide-react';
import { useCallback, useState } from 'react';
import { AccessKindsHelp } from '@/components/access/AccessKindsHelp';
import { BedtimeSlideover } from '@/components/people/BedtimeSlideover';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Card, CardContent } from '@/components/ui/card';
import { ErrorBanner } from '@/components/ui/error-banner';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusDot } from '@/components/ui/status-dot';
import { diasIniciales, minutesToHHMM } from '@/lib/access';
import { describeError } from '@/lib/errors';
import { plural, useT, type TranslationKey } from '@/lib/i18n';
import { clearBedtime, formatUntil, isPaused, listPeople, pausePerson, resumePerson } from '@/lib/people';
import { usePolling } from '@/lib/use-polling';
import { useAuthStore } from '@/store/auth.store';
import { toast } from '@/store/toast.store';

/**
 * Personas del hogar (US-240): el control parental **por quien es, no por MAC**.
 *
 * La pausa y los horarios existían desde US-108/111, pero solo por dispositivo:
 * «quitarle internet a Marta» eran seis acciones sobre seis MACs que hay que
 * saberse de memoria, y es exactamente la razón por la que se instala esto. Aquí
 * la unidad es la persona y el reparto a sus aparatos lo hace el servidor.
 */

/** Opciones de pausa, iguales que las del detalle de dispositivo (US-111). */
const PAUSE_OPTIONS = [30, 60, 120] as const;

/** Etiqueta corta de una duración de pausa. */
function pauseLabel(minutes: number): string {
  return minutes < 60 ? `${minutes} min` : `${minutes / 60} h`;
}

const REASON_KEY: Record<BlockReason, TranslationKey> = {
  manual: 'people.reason.manual',
  schedule: 'people.reason.schedule',
  paused: 'people.reason.paused',
};

const ROLE_KEY: Record<UserRole, TranslationKey> = {
  admin: 'people.role.admin',
  member: 'people.role.member',
  kid: 'people.role.kid',
  guest: 'people.role.guest',
  viewer: 'people.role.viewer',
};

interface PersonCardProps {
  person: PersonSummary;
  canEdit: boolean;
  onReload: () => void;
  onEditBedtime: () => void;
}

function PersonCard({ person, canEdit, onReload, onEditBedtime }: PersonCardProps) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const paused = isPaused(person);
  // El grupo «sin asignar» no es una persona: no se le pausa ni se le pone hora
  // de dormir, porque no hay a quién atribuirlo.
  const actionable = canEdit && person.userId !== null;

  /** Ejecuta una acción de persona reportando el parcial REAL, sin redondear a «hecho». */
  const run = async (
    action: () => Promise<{ applied: number; failed: number }>,
    okKey: TranslationKey,
    partialKey: TranslationKey,
    errKey: TranslationKey,
  ) => {
    setBusy(true);
    try {
      const result = await action();
      const total = result.applied + result.failed;
      if (result.failed > 0) {
        toast.error(t(partialKey, { applied: result.applied, total }));
      } else {
        toast.success(t(okKey));
      }
      onReload();
    } catch (err) {
      toast.error(describeError(err, t(errKey)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <UserRound size={20} className="text-kr-accent" aria-hidden />
          <h3 className="min-w-0 flex-1 truncate text-kr-base font-medium text-kr-primary">
            {person.name}
          </h3>
          {person.role && <Badge>{t(ROLE_KEY[person.role as UserRole])}</Badge>}
        </div>

        <p className="text-kr-sm text-kr-secondary">
          {person.devices.length === 0 ? (
            t('people.noDevices')
          ) : (
            <>
              {person.devices.length}{' '}
              {plural(person.devices.length, {
                one: t('people.device.one'),
                other: t('people.device.other'),
              })}
              {' · '}
              {t('people.onlineCount', { n: person.onlineCount })}
              {person.blockedCount > 0 && (
                <>
                  {' · '}
                  <span className="text-warning">
                    {t('people.blockedCount', { n: person.blockedCount })}
                  </span>
                </>
              )}
            </>
          )}
        </p>

        {/* Dispositivos con su estado y, si están cortados, POR QUÉ. */}
        {person.devices.length > 0 && (
          <ul className="space-y-1">
            {person.devices.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 text-kr-sm">
                <StatusDot
                  status={d.online ? 'online' : 'offline'}
                  label={d.online ? t('people.state.online') : t('people.state.offline')}
                />
                <span className="min-w-0 flex-1 truncate text-kr-secondary">{d.name}</span>
                {d.reasons.map((r) => (
                  <Badge key={r} variant="warning">
                    {t(REASON_KEY[r])}
                  </Badge>
                ))}
              </li>
            ))}
          </ul>
        )}

        {/* Pausa: un toque para toda la persona. */}
        {actionable && (
          <div className="flex flex-wrap items-center gap-2 text-kr-sm">
            {paused ? (
              <>
                <span className="text-warning">
                  {t('people.pausedUntil', { time: formatUntil(person.pausedUntil!) })}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  aria-label={t('people.resumeAria', { name: person.name })}
                  onClick={() =>
                    void run(
                      () => resumePerson(person.userId!),
                      'people.resumed',
                      'people.resumePartial',
                      'people.resumeError',
                    )
                  }
                >
                  {t('people.resume')}
                </Button>
              </>
            ) : (
              <>
                <span className="text-kr-secondary">{t('people.pause')}:</span>
                {PAUSE_OPTIONS.map((m) => (
                  <Button
                    key={m}
                    size="sm"
                    variant="outline"
                    disabled={busy || person.devices.length === 0}
                    aria-label={t('people.pauseAria', { name: person.name, minutes: m })}
                    onClick={() =>
                      void run(
                        () => pausePerson(person.userId!, m),
                        'people.paused',
                        'people.pausePartial',
                        'people.pauseError',
                      )
                    }
                  >
                    {pauseLabel(m)}
                  </Button>
                ))}
              </>
            )}
          </div>
        )}

        {/* Hora de dormir. */}
        <div className="space-y-1 border-t border-kr pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <Moon size={16} className="text-kr-secondary" aria-hidden />
            <span className="text-kr-sm font-medium text-kr-primary">{t('people.bedtime')}</span>
          </div>
          {person.bedtime ? (
            <>
              <p className="text-kr-sm text-kr-secondary">
                {t('people.bedtime.window', {
                  start: minutesToHHMM(person.bedtime.startMinute),
                  end: minutesToHHMM(person.bedtime.endMinute),
                })}
                {' · '}
                {person.bedtime.days.map((d) => diasIniciales(t)[d]).join(' ')}
                {!person.bedtime.enabled && ` ${t('people.bedtime.disabled')}`}
              </p>
              {/* Si no cubre a todos, se dice: prometer un corte que no ocurre es peor
                  que enseñar la discrepancia. */}
              {person.bedtime.appliedTo < person.devices.length && (
                <p className="text-kr-xs text-warning">
                  {t('people.bedtime.appliedTo', {
                    applied: person.bedtime.appliedTo,
                    total: person.devices.length,
                  })}
                </p>
              )}
            </>
          ) : (
            <p className="text-kr-sm text-kr-muted">{t('people.bedtime.none')}</p>
          )}
          {actionable && (
            <div className="flex flex-wrap gap-2 pt-1">
              <Button size="sm" variant="outline" onClick={onEditBedtime}>
                {person.bedtime ? t('people.bedtime.edit') : t('people.bedtime.set')}
              </Button>
              {person.bedtime && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () => clearBedtime(person.userId!),
                      'people.bedtime.cleared',
                      'people.bedtime.clearError',
                      'people.bedtime.clearError',
                    )
                  }
                >
                  {t('people.bedtime.remove')}
                </Button>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function PeoplePage() {
  const t = useT();
  const role = useAuthStore((s) => s.user?.role);
  const isAdmin = role === 'admin';
  const [people, setPeople] = useState<PersonSummary[] | null>(null);
  const [fullHome, setFullHome] = useState(true);
  const [unassigned, setUnassigned] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<PersonSummary | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await listPeople();
      setPeople(res.people);
      setFullHome(res.fullHome);
      setUnassigned(res.unassignedDevices);
      setError(null);
    } catch (err) {
      setError(describeError(err, t('people.loadError')));
    }
  }, [t]);

  // Los cortes vencen solos (pausa y horario), así que la vista se refresca sola.
  usePolling(load, 30_000);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-kr-xl font-semibold text-kr-primary">{t('people.title')}</h1>
        <p className="text-kr-sm text-kr-secondary">{t('people.subtitle')}</p>
      </div>

      <AccessKindsHelp />

      {!fullHome && (
        <Callout variant="info" standing>
          {t('people.onlyYou')}
        </Callout>
      )}

      {error && <ErrorBanner>{error}</ErrorBanner>}

      {people === null && !error && (
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
      )}

      {people !== null && people.length === 0 && (
        <Card>
          <CardContent className="space-y-1 p-6 text-center">
            <p className="text-kr-sm text-kr-secondary">{t('people.empty')}</p>
            <p className="text-kr-xs text-kr-muted">{t('people.emptyHint')}</p>
          </CardContent>
        </Card>
      )}

      {people !== null && people.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {people.map((p) => (
            <PersonCard
              key={p.userId ?? 'unassigned'}
              person={p}
              canEdit={isAdmin}
              onReload={() => void load()}
              onEditBedtime={() => setEditing(p)}
            />
          ))}
        </div>
      )}

      {/* Los aparatos sin dueño no son un error, pero sí lo que impide que esta
          pantalla sirva de algo: se dice dónde se arregla. */}
      {isAdmin && unassigned > 0 && (
        <p className="text-kr-xs text-kr-muted">
          {unassigned}{' '}
          {plural(unassigned, {
            one: t('people.device.one'),
            other: t('people.device.other'),
          })}{' '}
          {t('people.withoutOwner')}
          {' · '}
          {t('people.emptyHint')}
        </p>
      )}

      {editing && (
        <BedtimeSlideover
          person={editing}
          onClose={() => setEditing(null)}
          onSaved={() => void load()}
        />
      )}
    </div>
  );
}
