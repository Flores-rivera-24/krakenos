import type { ApPlacement, PlaceableAccessPoint, WifiBand } from '@krakenos/types';
import { useEffect, useState } from 'react';
import { Check, Plus, Trash2, Wifi, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ErrorBanner } from '@/components/ui/error-banner';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusDot } from '@/components/ui/status-dot';
import { Switch } from '@/components/ui/switch';
import { listPlaceableAccessPoints } from '@/lib/coverage';
import { describeError } from '@/lib/errors';

/** Bandas seleccionables por AP, en orden. */
const ALL_BANDS: { value: WifiBand; label: string }[] = [
  { value: '2.4GHz', label: '2.4 GHz' },
  { value: '5GHz', label: '5 GHz' },
  { value: '6GHz', label: '6 GHz' },
];

interface Props {
  /** APs ya colocados en el plano (estado del editor). */
  placedAps: ApPlacement[];
  /** Añade un AP real al plano (la página lo centra y le da un id local). */
  onAddAccessPoint: (ap: PlaceableAccessPoint) => void;
  /** Añade un AP manual/virtual (sin hardware detrás). */
  onAddManual: () => void;
  /** Edita un AP ya colocado. */
  onUpdateAp: (id: string, patch: Partial<ApPlacement>) => void;
  /** Quita un AP del plano. */
  onRemoveAp: (id: string) => void;
  /** Solo `admin` puede colocar/editar; a `viewer` se le deshabilita. */
  canEdit: boolean;
}

/**
 * Panel lateral del editor: lista los puntos de acceso detectados por el driver
 * para colocarlos en el plano y permite ajustar cada AP ya colocado (potencia,
 * bandas, activo) o quitarlo. Toda escritura está reservada a `admin`.
 */
export function ApPalette({
  placedAps,
  onAddAccessPoint,
  onAddManual,
  onUpdateAp,
  onRemoveAp,
  canEdit,
}: Props) {
  const [available, setAvailable] = useState<PlaceableAccessPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void listPlaceableAccessPoints()
      .then((list) => active && setAvailable(list))
      .catch(
        (err) =>
          active && setError(describeError(err, 'No se pudieron cargar los puntos de acceso')),
      )
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  const placedApIds = new Set(placedAps.map((ap) => ap.apId).filter((id): id is string => id != null));

  return (
    <div className="space-y-4">
      {/* APs detectados por el driver */}
      <div className="rounded-xl border border-kr bg-kr-surface p-4">
        <p className="mb-2 text-kr-sm font-medium text-kr-primary">Tus puntos de acceso</p>
        <p className="mb-3 text-kr-xs text-kr-muted">
          Detectados en tu red. Añádelos al plano y arrástralos a su sitio real.
        </p>

        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-9 w-full rounded-md" />
            <Skeleton className="h-9 w-full rounded-md" />
          </div>
        ) : error ? (
          <ErrorBanner>{error}</ErrorBanner>
        ) : available.length === 0 ? (
          <p className="text-kr-sm text-kr-muted">
            No se detectaron puntos de acceso. Puedes añadir uno manual más abajo.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {available.map((ap) => {
              const placed = placedApIds.has(ap.id);
              return (
                <li
                  key={ap.id}
                  className="flex items-center gap-2 rounded-md border border-kr bg-kr-bg px-2.5 py-2"
                >
                  {ap.online ? (
                    <Wifi className="h-5 w-5 shrink-0 text-kr-accent" aria-hidden />
                  ) : (
                    <WifiOff className="h-5 w-5 shrink-0 text-kr-muted" aria-hidden />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-kr-sm text-kr-primary">{ap.name}</p>
                    <p className="truncate text-kr-xs text-kr-muted">
                      {ap.model ? `${ap.model} · ` : ''}
                      {ap.ip}
                    </p>
                  </div>
                  {placed ? (
                    <span className="flex items-center gap-1 text-kr-xs text-success">
                      <Check className="h-4 w-4" aria-hidden />
                      En el plano
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!canEdit}
                      onClick={() => onAddAccessPoint(ap)}
                    >
                      <Plus className="h-4 w-4" aria-hidden />
                      Añadir
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {canEdit && (
          <Button variant="ghost" size="sm" className="mt-3 w-full" onClick={onAddManual}>
            <Plus className="h-4 w-4" aria-hidden />
            Añadir AP manual
          </Button>
        )}
      </div>

      {/* Ajustes de los APs colocados */}
      {placedAps.length > 0 && (
        <div className="rounded-xl border border-kr bg-kr-surface p-4">
          <p className="mb-3 text-kr-sm font-medium text-kr-primary">
            En el plano ({placedAps.length})
          </p>
          <ul className="space-y-3">
            {placedAps.map((ap) => (
              <li key={ap.id} className="rounded-md border border-kr bg-kr-bg p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <StatusDot status={ap.enabled ? 'online' : 'offline'} />
                    <span className="truncate text-kr-sm text-kr-primary">{ap.name}</span>
                  </span>
                  <button
                    type="button"
                    disabled={!canEdit}
                    onClick={() => onRemoveAp(ap.id)}
                    aria-label={`Quitar ${ap.name}`}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-kr-secondary hover:bg-kr-elevated hover:text-danger disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                </div>

                <label className="mb-2 block text-kr-xs text-kr-secondary">
                  <span className="mb-1 flex items-center justify-between">
                    <span>Potencia (EIRP)</span>
                    <span className="tabular-nums text-kr-muted">{ap.txPowerDbm} dBm</span>
                  </span>
                  <input
                    type="range"
                    min={1}
                    max={30}
                    step={1}
                    value={ap.txPowerDbm}
                    disabled={!canEdit}
                    onChange={(e) => onUpdateAp(ap.id, { txPowerDbm: Number(e.target.value) })}
                    className="w-full disabled:cursor-not-allowed disabled:opacity-50"
                    style={{ accentColor: 'var(--kr-accent)' }}
                    aria-label={`Potencia de ${ap.name} en dBm`}
                  />
                </label>

                <div className="mb-2">
                  <span className="mb-1 block text-kr-xs text-kr-secondary">Bandas</span>
                  <div className="flex flex-wrap gap-2">
                    {ALL_BANDS.map((b) => {
                      const on = ap.bands.includes(b.value);
                      return (
                        <label
                          key={b.value}
                          className="flex cursor-pointer items-center gap-1 text-kr-xs text-kr-secondary"
                        >
                          <input
                            type="checkbox"
                            checked={on}
                            disabled={!canEdit}
                            onChange={() => {
                              const next = on
                                ? ap.bands.filter((x) => x !== b.value)
                                : [...ap.bands, b.value];
                              onUpdateAp(ap.id, { bands: next });
                            }}
                            style={{ accentColor: 'var(--kr-accent)' }}
                          />
                          {b.label}
                        </label>
                      );
                    })}
                  </div>
                </div>

                <label className="flex items-center justify-between text-kr-xs text-kr-secondary">
                  <span>Activo</span>
                  <Switch
                    checked={ap.enabled}
                    disabled={!canEdit}
                    onCheckedChange={(v) => onUpdateAp(ap.id, { enabled: v })}
                    aria-label={`Activar ${ap.name}`}
                  />
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
