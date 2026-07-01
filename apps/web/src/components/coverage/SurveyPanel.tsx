import type {
  CoverageHeatmap,
  Device,
  SurveyScan,
  SurveyScanDetail,
  WifiBand,
} from '@krakenos/types';
import { useCallback, useEffect, useState } from 'react';
import { MapPin, Plus, Radar, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { ErrorBanner } from '@/components/ui/error-banner';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { createScan, deleteScan, getMeasuredHeatmap, getScan, listScans } from '@/lib/coverage';
import { describeError } from '@/lib/errors';
import { toast } from '@/store/toast.store';

const BANDS: WifiBand[] = ['2.4GHz', '5GHz', '6GHz'];

interface Props {
  floorPlanId: string;
  /** Banda por defecto al crear un survey (la seleccionada en la barra). */
  defaultBand: WifiBand;
  /** Survey activo (modo medir): al tocar el plano se registra una muestra. */
  activeScan: SurveyScanDetail | null;
  onActiveScanChange: (scan: SurveyScanDetail | null) => void;
  /** Heatmap medido cargado (para pintarlo bajo el plano). */
  measuredHeatmap: CoverageHeatmap | null;
  onMeasuredHeatmapChange: (heatmap: CoverageHeatmap | null) => void;
  /** Alterna entre ver el heatmap medido (true) o solo los puntos (false). */
  showMeasured: boolean;
  onShowMeasuredChange: (show: boolean) => void;
  /** Señal (dBm) a registrar en surveys manuales (sin dispositivo itinerante). */
  manualRssiDbm: number;
  onManualRssiChange: (value: number) => void;
  /** Solo `admin` puede crear surveys y medir. */
  canEdit: boolean;
}

function deviceName(d: Device): string {
  return d.label ?? d.hostname ?? d.mac;
}

/**
 * Panel del modo Survey: crea y elige recorridos de medición (`SurveyScan`),
 * activa el modo medir (tocar el plano registra la señal real en vivo del
 * dispositivo itinerante) y permite ver el mapa de calor medido frente a los
 * puntos sueltos. Crear/medir está reservado a `admin`.
 */
export function SurveyPanel({
  floorPlanId,
  defaultBand,
  activeScan,
  onActiveScanChange,
  measuredHeatmap,
  onMeasuredHeatmapChange,
  showMeasured,
  onShowMeasuredChange,
  manualRssiDbm,
  onManualRssiChange,
  canEdit,
}: Props) {
  const [scans, setScans] = useState<SurveyScan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Formulario de alta.
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [band, setBand] = useState<WifiBand>(defaultBand);
  const [deviceMac, setDeviceMac] = useState<string>('');
  const [creating, setCreating] = useState(false);

  const [devices, setDevices] = useState<Device[]>([]);
  const [heatmapLoading, setHeatmapLoading] = useState(false);

  const reloadScans = useCallback(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void listScans(floorPlanId)
      .then((list) => active && setScans(list))
      .catch(
        (err) => active && setError(describeError(err, 'No se pudieron cargar los surveys')),
      )
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [floorPlanId]);

  useEffect(() => reloadScans(), [reloadScans]);

  // Lista de dispositivos (para elegir el itinerante del survey).
  useEffect(() => {
    let active = true;
    void api
      .get<Device[]>('/inventory')
      .then((list) => active && setDevices(list))
      .catch(() => {
        /* silencioso: el desplegable simplemente queda vacío */
      });
    return () => {
      active = false;
    };
  }, []);

  const handleSelectScan = useCallback(
    async (id: string) => {
      onShowMeasuredChange(false);
      onMeasuredHeatmapChange(null);
      try {
        const detail = await getScan(id);
        onActiveScanChange(detail);
      } catch (err) {
        toast.error(describeError(err, 'No se pudo abrir el survey'));
      }
    },
    [onActiveScanChange, onMeasuredHeatmapChange, onShowMeasuredChange],
  );

  const handleCreate = useCallback(async () => {
    if (name.trim() === '') return;
    setCreating(true);
    try {
      const scan = await createScan(floorPlanId, {
        name: name.trim(),
        band,
        deviceMac: deviceMac === '' ? null : deviceMac,
      });
      setScans((prev) => [scan, ...prev]);
      setName('');
      setShowForm(false);
      toast.success('Survey creado');
      await handleSelectScan(scan.id);
    } catch (err) {
      toast.error(describeError(err, 'No se pudo crear el survey'));
    } finally {
      setCreating(false);
    }
  }, [floorPlanId, name, band, deviceMac, handleSelectScan]);

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await deleteScan(id);
        setScans((prev) => prev.filter((s) => s.id !== id));
        if (activeScan?.id === id) {
          onActiveScanChange(null);
          onMeasuredHeatmapChange(null);
          onShowMeasuredChange(false);
        }
        toast.success('Survey eliminado');
      } catch (err) {
        toast.error(describeError(err, 'No se pudo eliminar el survey'));
      }
    },
    [activeScan, onActiveScanChange, onMeasuredHeatmapChange, onShowMeasuredChange],
  );

  const handleToggleMeasured = useCallback(async () => {
    if (!activeScan) return;
    if (showMeasured) {
      onShowMeasuredChange(false);
      return;
    }
    setHeatmapLoading(true);
    try {
      const heatmap = await getMeasuredHeatmap(activeScan.id);
      onMeasuredHeatmapChange(heatmap);
      onShowMeasuredChange(true);
    } catch (err) {
      toast.error(describeError(err, 'No se pudo calcular el mapa medido'));
    } finally {
      setHeatmapLoading(false);
    }
  }, [activeScan, showMeasured, onMeasuredHeatmapChange, onShowMeasuredChange]);

  const sampleCount = activeScan?.samples.length ?? 0;

  return (
    <div className="space-y-4">
      {/* Survey activo / modo medir */}
      {activeScan && (
        <div className="rounded-xl border border-kr bg-kr-surface p-4">
          <div className="mb-2 flex items-center gap-1.5">
            <Radar className="h-5 w-5 text-kr-accent" aria-hidden />
            <p className="min-w-0 flex-1 truncate text-kr-sm font-medium text-kr-primary">
              {activeScan.name}
            </p>
            <span className="rounded-full border border-kr px-2 py-0.5 text-kr-xs text-kr-secondary">
              {activeScan.band}
            </span>
          </div>
          <p className="mb-3 flex items-center gap-1.5 text-kr-sm text-kr-secondary">
            <MapPin className="h-4 w-4 text-kr-muted" aria-hidden />
            {sampleCount} {sampleCount === 1 ? 'muestra' : 'muestras'}
          </p>
          {canEdit ? (
            activeScan.deviceMac == null ? (
              <div className="mb-3 space-y-1.5 rounded-md bg-kr-elevated px-2.5 py-2">
                <Label htmlFor="manual-rssi" className="text-kr-xs text-kr-secondary">
                  Señal a registrar (dBm)
                </Label>
                <Input
                  id="manual-rssi"
                  type="number"
                  min={-120}
                  max={0}
                  value={manualRssiDbm}
                  onChange={(e) => onManualRssiChange(Number(e.target.value))}
                  className="h-8"
                />
                <p className="text-kr-xs text-kr-muted">
                  Survey manual: escribe la señal que marca tu móvil (p. ej. −58) y toca el plano en
                  ese punto para registrarla.
                </p>
              </div>
            ) : (
              <p className="mb-3 rounded-md bg-kr-elevated px-2.5 py-2 text-kr-xs text-kr-secondary">
                Modo medir activo: toca el plano donde estés para registrar la señal real de{' '}
                {activeScan.deviceMac} en ese punto.
              </p>
            )
          ) : (
            <p className="mb-3 text-kr-xs text-kr-muted">
              Solo un administrador puede registrar mediciones.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={showMeasured ? 'default' : 'outline'}
              disabled={heatmapLoading}
              onClick={() => void handleToggleMeasured()}
            >
              {heatmapLoading
                ? 'Calculando…'
                : showMeasured
                  ? 'Ver puntos'
                  : 'Ver mapa medido'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                onActiveScanChange(null);
                onMeasuredHeatmapChange(null);
                onShowMeasuredChange(false);
              }}
            >
              Cerrar survey
            </Button>
          </div>
          {measuredHeatmap && showMeasured && sampleCount === 0 && (
            <p className="mt-2 text-kr-xs text-kr-muted">
              Aún no hay muestras: mide algunos puntos para ver el mapa.
            </p>
          )}
        </div>
      )}

      {/* Lista de surveys */}
      <div className="rounded-xl border border-kr bg-kr-surface p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-kr-sm font-medium text-kr-primary">Recorridos de medición</p>
          {canEdit && !showForm && (
            <Button size="sm" variant="outline" onClick={() => setShowForm(true)}>
              <Plus className="h-4 w-4" aria-hidden />
              Nuevo
            </Button>
          )}
        </div>

        {showForm && (
          <div className="mb-3 space-y-3 rounded-md border border-kr bg-kr-bg p-3">
            <div className="space-y-1.5">
              <Label htmlFor="survey-name">Nombre</Label>
              <Input
                id="survey-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="p. ej. Recorrido planta baja"
                maxLength={64}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="survey-band">Banda</Label>
              <select
                id="survey-band"
                value={band}
                onChange={(e) => setBand(e.target.value as WifiBand)}
                className="h-9 w-full rounded-md border border-kr bg-kr-bg px-2 text-kr-sm text-kr-primary"
              >
                {BANDS.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="survey-device">Dispositivo itinerante</Label>
              <select
                id="survey-device"
                value={deviceMac}
                onChange={(e) => setDeviceMac(e.target.value)}
                className="h-9 w-full rounded-md border border-kr bg-kr-bg px-2 text-kr-sm text-kr-primary"
              >
                <option value="">Manual (introduzco los valores)</option>
                {devices.map((d) => (
                  <option key={d.id} value={d.mac}>
                    {deviceName(d)}
                  </option>
                ))}
              </select>
              <p className="text-kr-xs text-kr-muted">
                Su señal en vivo se registrará al tocar el plano. Elige «Manual» si no aparece.
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={creating || name.trim() === ''}
                onClick={() => void handleCreate()}
              >
                {creating ? 'Creando…' : 'Crear survey'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>
                Cancelar
              </Button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-9 w-full rounded-md" />
            <Skeleton className="h-9 w-full rounded-md" />
          </div>
        ) : error ? (
          <ErrorBanner>{error}</ErrorBanner>
        ) : scans.length === 0 ? (
          <p className="text-kr-sm text-kr-muted">
            Aún no hay recorridos. Crea uno para empezar a medir la cobertura real.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {scans.map((scan) => {
              const active = scan.id === activeScan?.id;
              return (
                <li
                  key={scan.id}
                  className={
                    active
                      ? 'flex items-center gap-2 rounded-md border border-kr-accent bg-kr-elevated px-2.5 py-2'
                      : 'flex items-center gap-2 rounded-md border border-kr bg-kr-bg px-2.5 py-2'
                  }
                >
                  <button
                    type="button"
                    onClick={() => void handleSelectScan(scan.id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span className="block truncate text-kr-sm text-kr-primary">{scan.name}</span>
                    <span className="block truncate text-kr-xs text-kr-muted">
                      {scan.band}
                      {scan.deviceMac ? ` · ${scan.deviceMac}` : ' · manual'}
                    </span>
                  </button>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => void handleDelete(scan.id)}
                      aria-label={`Eliminar ${scan.name}`}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-kr-secondary hover:bg-kr-elevated hover:text-danger"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
