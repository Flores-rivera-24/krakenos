import type {
  ApPlacement,
  CoverageHeatmap,
  FloorPlan,
  PlaceableAccessPoint,
  SurveyScanDetail,
  Wall,
  WallMaterial,
  WifiBand,
} from '@krakenos/types';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapPinned, Pencil } from 'lucide-react';
import { ApPalette } from '@/components/coverage/ApPalette';
import { CoverageToolbar } from '@/components/coverage/CoverageToolbar';
import { FloorPlanFormSlideover } from '@/components/coverage/FloorPlanFormSlideover';
import { FloorPlanStage, type CoverageTool } from '@/components/coverage/FloorPlanStage';
import { HeatmapLegend } from '@/components/coverage/HeatmapLegend';
import { SurveyPanel } from '@/components/coverage/SurveyPanel';
import { Button } from '@/components/ui/button';
import { ErrorBanner } from '@/components/ui/error-banner';
import { Skeleton } from '@/components/ui/skeleton';
import {
  getMeasuredHeatmap,
  getPredictedHeatmap,
  getScan,
  listFloorPlans,
  recordSample,
  updateFloorPlan,
} from '@/lib/coverage';
import { formatDbm } from '@/lib/coverage-format';
import { describeError } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/auth.store';
import { toast } from '@/store/toast.store';

/** Vistas del lienzo de cobertura. */
type CoverageView = 'edit' | 'predict' | 'survey';

const VIEWS: { id: CoverageView; label: string }[] = [
  { id: 'edit', label: 'Editar' },
  { id: 'predict', label: 'Predicción' },
  { id: 'survey', label: 'Survey' },
];

const BANDS: WifiBand[] = ['2.4GHz', '5GHz', '6GHz'];

/** Genera un id local para paredes/APs creados en el editor antes de guardar. */
function localId(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `${prefix}-${rand}`;
}

/**
 * Página de Cobertura WiFi: el lienzo interactivo de plano + heatmap. Permite
 * editar el plano (paredes/APs), ver la predicción de señal por propagación RF y
 * (vía panel del segundo agente) medir cobertura real con un survey.
 */
export function CoveragePage() {
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin');

  const [plans, setPlans] = useState<FloorPlan[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Slideover de alta de plano y, aparte, de edición del plano seleccionado.
  const [mostrarFormPlano, setMostrarFormPlano] = useState(false);
  const [planoEnEdicion, setPlanoEnEdicion] = useState<FloorPlan | null>(null);

  // Estado del editor (se siembra al seleccionar plano; se persiste al Guardar).
  const [editWalls, setEditWalls] = useState<Wall[]>([]);
  const [editAps, setEditAps] = useState<ApPlacement[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const [tool, setTool] = useState<CoverageTool>('select');
  const [wallMaterial, setWallMaterial] = useState<WallMaterial>('drywall');
  const [view, setView] = useState<CoverageView>('edit');
  const [band, setBand] = useState<WifiBand>('5GHz');

  // Heatmap predicho (vista Predicción).
  const [heatmap, setHeatmap] = useState<CoverageHeatmap | null>(null);
  const [heatmapLoading, setHeatmapLoading] = useState(false);
  const [heatmapError, setHeatmapError] = useState<string | null>(null);

  // Estado del modo Survey (vista Survey).
  const [activeScan, setActiveScan] = useState<SurveyScanDetail | null>(null);
  const [measuredHeatmap, setMeasuredHeatmap] = useState<CoverageHeatmap | null>(null);
  const [showMeasured, setShowMeasured] = useState(false);
  // Valor de señal para surveys manuales (sin dispositivo itinerante).
  const [manualRssiDbm, setManualRssiDbm] = useState(-60);

  const selectedPlan = useMemo(
    () => plans.find((p) => p.id === selectedId) ?? null,
    [plans, selectedId],
  );

  // Carga inicial de la lista de planos.
  useEffect(() => {
    let active = true;
    void listFloorPlans()
      .then((list) => {
        if (!active) return;
        setPlans(list);
        setSelectedId((prev) => prev ?? list[0]?.id ?? null);
      })
      .catch((err) => active && setError(describeError(err, 'No se pudieron cargar los planos')))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  // Al cambiar de plano (por id), siembra el estado del editor y limpia el
  // "dirty". Se guarda el id ya sembrado en un ref para NO re-sembrar cuando el
  // mismo plano se reemplaza por una edición de metadatos (nombre/medidas): eso
  // descartaría las paredes/APs sin guardar del editor.
  const seededPlanId = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedPlan) {
      setEditWalls([]);
      setEditAps([]);
      setDirty(false);
      seededPlanId.current = null;
      return;
    }
    if (seededPlanId.current === selectedPlan.id) return;
    seededPlanId.current = selectedPlan.id;
    setEditWalls(selectedPlan.walls);
    setEditAps(selectedPlan.accessPoints);
    setDirty(false);
    // El survey activo/medido pertenece a un plano concreto: al cambiar, se limpia.
    setActiveScan(null);
    setMeasuredHeatmap(null);
    setShowMeasured(false);
  }, [selectedPlan]);

  // Pide la predicción al backend sobre el plano GUARDADO cuando toca.
  useEffect(() => {
    if (view !== 'predict' || !selectedId) {
      setHeatmap(null);
      return;
    }
    let active = true;
    setHeatmapLoading(true);
    setHeatmapError(null);
    void getPredictedHeatmap(selectedId, band)
      .then((h) => active && setHeatmap(h))
      .catch((err) => {
        if (!active) return;
        setHeatmap(null);
        setHeatmapError(describeError(err, 'No se pudo calcular la predicción'));
      })
      .finally(() => active && setHeatmapLoading(false));
    return () => {
      active = false;
    };
    // `updatedAt` en deps: recalcula la predicción tras guardar geometría o
    // cambiar las medidas del plano (si no, el heatmap quedaría desalineado).
  }, [view, selectedId, band, selectedPlan?.updatedAt]);

  const handleAddWall = useCallback((wall: Omit<Wall, 'id'>) => {
    setEditWalls((prev) => [...prev, { ...wall, id: localId('wall') }]);
    setDirty(true);
  }, []);

  const handleMoveAp = useCallback((id: string, x: number, y: number) => {
    setEditAps((prev) => prev.map((ap) => (ap.id === id ? { ...ap, x, y } : ap)));
    setDirty(true);
  }, []);

  const handleAddAp = useCallback(
    (x: number, y: number) => {
      setEditAps((prev) => [
        ...prev,
        {
          id: localId('ap'),
          apId: null,
          name: `AP ${prev.length + 1}`,
          x,
          y,
          txPowerDbm: 20,
          bands: [band],
          enabled: true,
        },
      ]);
      setDirty(true);
    },
    [band],
  );

  // Añade un AP real del driver, centrado en el plano (luego se arrastra a su sitio).
  const handleAddPlaceableAp = useCallback(
    (ap: PlaceableAccessPoint) => {
      if (!selectedPlan) return;
      setEditAps((prev) => [
        ...prev,
        {
          id: localId('ap'),
          apId: ap.id,
          name: ap.name,
          x: selectedPlan.widthM / 2,
          y: selectedPlan.heightM / 2,
          txPowerDbm: 20,
          bands: ap.bands.length > 0 ? ap.bands : [band],
          enabled: true,
        },
      ]);
      setDirty(true);
    },
    [selectedPlan, band],
  );

  const handleAddManualAp = useCallback(() => {
    if (!selectedPlan) return;
    handleAddAp(selectedPlan.widthM / 2, selectedPlan.heightM / 2);
  }, [selectedPlan, handleAddAp]);

  const handleUpdateAp = useCallback((id: string, patch: Partial<ApPlacement>) => {
    setEditAps((prev) => prev.map((ap) => (ap.id === id ? { ...ap, ...patch } : ap)));
    setDirty(true);
  }, []);

  const handleRemoveAp = useCallback((id: string) => {
    setEditAps((prev) => prev.filter((ap) => ap.id !== id));
    setDirty(true);
  }, []);

  // Modo medir (vista Survey): tocar el plano registra la señal real en ese punto.
  const handlePlacePoint = useCallback(
    async (x: number, y: number) => {
      if (!activeScan) {
        toast.info('Elige o crea un survey antes de medir');
        return;
      }
      try {
        // Survey con dispositivo → mide en vivo; survey manual (sin deviceMac) →
        // envía el valor de señal indicado en el panel.
        const isManual = activeScan.deviceMac == null;
        const result = await recordSample(
          activeScan.id,
          isManual ? { x, y, rssiDbm: manualRssiDbm } : { x, y },
        );
        if (!result.found) {
          toast.info('No se detectó el dispositivo aquí');
        } else {
          toast.success(`Medido: ${formatDbm(result.rssiDbm)}`);
        }
        const detail = await getScan(activeScan.id);
        setActiveScan(detail);
        if (showMeasured) {
          setMeasuredHeatmap(await getMeasuredHeatmap(activeScan.id));
        }
      } catch (err) {
        toast.error(describeError(err, 'No se pudo registrar la medición'));
      }
    },
    [activeScan, showMeasured, manualRssiDbm],
  );

  const handleSave = useCallback(async () => {
    if (!selectedId) return;
    setSaving(true);
    try {
      const updated = await updateFloorPlan(selectedId, {
        walls: editWalls,
        accessPoints: editAps,
      });
      setPlans((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      setDirty(false);
      toast.success('Plano guardado');
    } catch (err) {
      toast.error(describeError(err, 'No se pudo guardar el plano'));
    } finally {
      setSaving(false);
    }
  }, [selectedId, editWalls, editAps]);

  // Alta/edición de plano desde el slideover: inserta o reemplaza y selecciona.
  const handlePlanSaved = useCallback((saved: FloorPlan) => {
    setPlans((prev) => {
      const exists = prev.some((p) => p.id === saved.id);
      return exists ? prev.map((p) => (p.id === saved.id ? saved : p)) : [...prev, saved];
    });
    setSelectedId(saved.id);
  }, []);

  const handlePlanDeleted = useCallback(
    (id: string) => {
      setPlans((prev) => {
        const next = prev.filter((p) => p.id !== id);
        setSelectedId((cur) => (cur === id ? (next[0]?.id ?? null) : cur));
        return next;
      });
    },
    [],
  );

  // ---- Render ----

  if (loading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-[420px] w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Cobertura WiFi</h2>
          <p className="text-sm text-muted-foreground">
            Dibuja el plano de tu casa, coloca los puntos de acceso y comprueba dónde llega la señal.
          </p>
        </div>
        {isAdmin && plans.length > 0 && (
          <Button variant="outline" size="sm" onClick={() => setMostrarFormPlano(true)}>
            <MapPinned className="h-4 w-4" aria-hidden />
            Nuevo plano
          </Button>
        )}
      </div>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      {!error && plans.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-kr bg-kr-surface py-16 text-center">
          <p className="text-kr-secondary">Aún no has creado ningún plano.</p>
          <p className="mx-auto max-w-md text-kr-sm text-kr-muted">
            Crea un plano de tu casa con sus medidas para colocar los puntos de acceso y ver un mapa
            de calor de la cobertura WiFi.
          </p>
          {isAdmin && (
            <Button onClick={() => setMostrarFormPlano(true)}>
              <MapPinned className="h-4 w-4" aria-hidden />
              Crear plano
            </Button>
          )}
        </div>
      ) : (
        selectedPlan && (
          <>
            {/* Barra superior: selector de plano + vista + banda */}
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={selectedId ?? ''}
                onChange={(e) => setSelectedId(e.target.value)}
                aria-label="Plano"
                className="h-9 rounded-md border border-kr bg-kr-bg px-2 text-kr-sm text-kr-primary"
              >
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>

              <div
                className="flex items-center gap-1 rounded-md border border-kr p-0.5"
                role="group"
                aria-label="Vista"
              >
                {VIEWS.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    aria-pressed={view === v.id}
                    onClick={() => setView(v.id)}
                    className={cn(
                      'h-8 rounded px-3 text-kr-sm transition-colors',
                      view === v.id
                        ? 'bg-kr-accent text-white'
                        : 'text-kr-secondary hover:bg-kr-elevated hover:text-kr-primary',
                    )}
                  >
                    {v.label}
                  </button>
                ))}
              </div>

              {view === 'predict' && (
                <div
                  className="flex items-center gap-1 rounded-md border border-kr p-0.5"
                  role="group"
                  aria-label="Banda"
                >
                  {BANDS.map((b) => (
                    <button
                      key={b}
                      type="button"
                      aria-pressed={band === b}
                      onClick={() => setBand(b)}
                      className={cn(
                        'h-8 rounded px-3 text-kr-sm transition-colors',
                        band === b
                          ? 'bg-kr-accent text-white'
                          : 'text-kr-secondary hover:bg-kr-elevated hover:text-kr-primary',
                      )}
                    >
                      {b}
                    </button>
                  ))}
                </div>
              )}

              {isAdmin && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto"
                  onClick={() => setPlanoEnEdicion(selectedPlan)}
                >
                  <Pencil className="h-4 w-4" aria-hidden />
                  Editar plano
                </Button>
              )}
            </div>

            {view === 'edit' && (
              <CoverageToolbar
                tool={tool}
                onToolChange={setTool}
                wallMaterial={wallMaterial}
                onWallMaterialChange={setWallMaterial}
                onSave={() => void handleSave()}
                saving={saving}
                dirty={dirty}
                canEdit={isAdmin}
              />
            )}

            {view === 'predict' && heatmapError && <ErrorBanner>{heatmapError}</ErrorBanner>}

            <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
              <div className="space-y-3">
                {view === 'predict' && heatmapLoading ? (
                  <Skeleton className="h-[420px] w-full rounded-xl" />
                ) : (
                  <FloorPlanStage
                    plan={selectedPlan}
                    heatmap={
                      view === 'predict'
                        ? heatmap
                        : view === 'survey' && showMeasured
                          ? measuredHeatmap
                          : null
                    }
                    walls={editWalls}
                    accessPoints={editAps}
                    surveySamples={view === 'survey' ? activeScan?.samples : undefined}
                    tool={
                      view === 'edit' ? tool : view === 'survey' ? 'measure' : 'select'
                    }
                    wallMaterial={wallMaterial}
                    onAddWall={handleAddWall}
                    onMoveAp={handleMoveAp}
                    onAddAp={handleAddAp}
                    onPlacePoint={(x, y) => void handlePlacePoint(x, y)}
                    readOnly={
                      view === 'edit'
                        ? !isAdmin
                        : view === 'survey'
                          ? !isAdmin || !activeScan
                          : true
                    }
                  />
                )}
                {view !== 'edit' && <HeatmapLegend />}
              </div>

              {/* Panel lateral por vista */}
              <aside className="space-y-4">
                {view === 'edit' && (
                  <>
                    <div className="rounded-xl border border-kr bg-kr-surface p-4 text-kr-sm text-kr-secondary">
                      <p className="mb-2 font-medium text-kr-primary">Editar el plano</p>
                      <ul className="list-disc space-y-1 pl-4 text-kr-muted">
                        <li>«Pared»: arrastra para trazar un muro con el material elegido.</li>
                        <li>«Punto de acceso»: haz clic para colocar un AP.</li>
                        <li>«Seleccionar»: arrastra un AP para moverlo.</li>
                      </ul>
                    </div>
                    <ApPalette
                      placedAps={editAps}
                      onAddAccessPoint={handleAddPlaceableAp}
                      onAddManual={handleAddManualAp}
                      onUpdateAp={handleUpdateAp}
                      onRemoveAp={handleRemoveAp}
                      canEdit={isAdmin}
                    />
                  </>
                )}

                {view === 'survey' && (
                  <SurveyPanel
                    floorPlanId={selectedPlan.id}
                    defaultBand={band}
                    activeScan={activeScan}
                    onActiveScanChange={setActiveScan}
                    measuredHeatmap={measuredHeatmap}
                    onMeasuredHeatmapChange={setMeasuredHeatmap}
                    showMeasured={showMeasured}
                    onShowMeasuredChange={setShowMeasured}
                    manualRssiDbm={manualRssiDbm}
                    onManualRssiChange={setManualRssiDbm}
                    canEdit={isAdmin}
                  />
                )}

                {view === 'predict' && (
                  <div className="rounded-xl border border-kr bg-kr-surface p-4 text-kr-sm text-kr-secondary">
                    <p className="font-medium text-kr-primary">Predicción de señal</p>
                    <p className="mt-1 text-kr-muted">
                      Estimación por propagación RF con las paredes y los APs guardados en la banda{' '}
                      {band}. Guarda tus cambios en «Editar» para verlos reflejados aquí.
                    </p>
                  </div>
                )}
              </aside>
            </div>
          </>
        )
      )}

      {/* Alta de un plano nuevo */}
      {mostrarFormPlano && (
        <FloorPlanFormSlideover
          onClose={() => setMostrarFormPlano(false)}
          onSaved={handlePlanSaved}
        />
      )}

      {/* Edición del plano seleccionado (incl. borrado) */}
      {planoEnEdicion && (
        <FloorPlanFormSlideover
          plan={planoEnEdicion}
          onClose={() => setPlanoEnEdicion(null)}
          onSaved={handlePlanSaved}
          onDeleted={handlePlanDeleted}
        />
      )}
    </div>
  );
}
