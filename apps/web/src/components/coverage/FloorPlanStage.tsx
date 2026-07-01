import type {
  ApPlacement,
  CoverageHeatmap,
  FloorPlan,
  SurveySample,
  Wall,
  WallMaterial,
} from '@krakenos/types';
import { signalQuality } from '@krakenos/types';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { heatmapRgba, signalQualityColorVar, WALL_MATERIAL_LABELS } from '@/lib/coverage-format';

/** Herramienta activa del lienzo. */
export type CoverageTool = 'select' | 'wall' | 'ap' | 'measure';

interface Props {
  plan: FloorPlan;
  /** Mapa de calor raster a pintar bajo el plano (predicho o medido), o `null`. */
  heatmap?: CoverageHeatmap | null;
  walls: Wall[];
  accessPoints: ApPlacement[];
  surveySamples?: SurveySample[];
  tool: CoverageTool;
  /** Material con el que se crean las paredes nuevas (herramienta `wall`). */
  wallMaterial?: WallMaterial;
  /** Alta de una pared (click-drag con la herramienta `wall`). */
  onAddWall?: (wall: Omit<Wall, 'id'>) => void;
  /** Movimiento de un AP arrastrado (herramienta `select`). */
  onMoveAp?: (id: string, x: number, y: number) => void;
  /** Colocación de un AP nuevo (click con la herramienta `ap`). */
  onAddAp?: (x: number, y: number) => void;
  /** Colocación de un punto de medición (click con la herramienta `measure`). */
  onPlacePoint?: (x: number, y: number) => void;
  /** Selección de un AP existente (click con la herramienta `select`). */
  onSelectAp?: (id: string) => void;
  /** Escala fija píxeles/metro; si se omite, se ajusta al ancho del contenedor. */
  pxPerM?: number;
  /** Solo lectura: sin arrastres ni altas (p. ej. para `viewer`). */
  readOnly?: boolean;
}

/** Ancho por defecto si aún no se ha medido el contenedor. */
const FALLBACK_WIDTH_PX = 640;
/** Radio en píxeles del icono de un AP sobre el plano. */
const AP_RADIUS_PX = 13;
/** Radio en píxeles de un punto de medición (survey). */
const SAMPLE_RADIUS_PX = 5;

/** Grosor de trazo por material (pista visual de su densidad/atenuación). */
const WALL_STROKE_WIDTH: Record<WallMaterial, number> = {
  drywall: 2,
  wood: 2.5,
  glass: 2,
  brick: 3.5,
  concrete: 5,
  metal: 5,
};

/**
 * Lienzo interactivo del plano: un `<canvas>` posicionado en absoluto pinta el
 * mapa de calor raster y, encima, un `<svg>` dibuja paredes, APs (arrastrables)
 * y puntos de medición. Las coordenadas del modelo están en metros; se mapean a
 * píxeles con `pxPerM`. La pieza estrella de Cobertura WiFi.
 */
export function FloorPlanStage({
  plan,
  heatmap,
  walls,
  accessPoints,
  surveySamples,
  tool,
  wallMaterial = 'drywall',
  onAddWall,
  onMoveAp,
  onAddAp,
  onPlacePoint,
  onSelectAp,
  pxPerM: pxPerMProp,
  readOnly = false,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [measuredW, setMeasuredW] = useState<number | null>(null);

  // Arrastre de AP en curso (offset entre el puntero y el centro del AP).
  const dragApRef = useRef<{ id: string; offX: number; offY: number } | null>(null);
  // Borrador de pared mientras se arrastra (metros).
  const [wallDraft, setWallDraft] = useState<{
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  } | null>(null);

  // Escala px/m: ajusta el ancho real del plano al contenedor, salvo escala fija.
  const pxPerM = pxPerMProp ?? (measuredW ?? FALLBACK_WIDTH_PX) / Math.max(plan.widthM, 0.001);
  const widthPx = plan.widthM * pxPerM;
  const heightPx = plan.heightM * pxPerM;

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setMeasuredW(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Pinta el mapa de calor en el canvas (ImageData por celdas escaladas a px).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(widthPx * dpr));
    canvas.height = Math.max(1, Math.round(heightPx * dpr));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, widthPx, heightPx);
    if (!heatmap) return;

    const cellPx = heatmap.cellSizeM * pxPerM;
    for (let row = 0; row < heatmap.rows; row++) {
      for (let col = 0; col < heatmap.cols; col++) {
        const dbm = heatmap.values[row * heatmap.cols + col] ?? null;
        if (dbm == null) continue;
        ctx.fillStyle = heatmapRgba(dbm);
        // +0.75px de solape para que no queden costuras entre celdas.
        ctx.fillRect(col * cellPx, row * cellPx, cellPx + 0.75, cellPx + 0.75);
      }
    }
  }, [heatmap, pxPerM, widthPx, heightPx]);

  const toMeters = useCallback(
    (e: { clientX: number; clientY: number }): { x: number; y: number } => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return { x: (e.clientX - rect.left) / pxPerM, y: (e.clientY - rect.top) / pxPerM };
    },
    [pxPerM],
  );

  const clamp = useCallback(
    (p: { x: number; y: number }): { x: number; y: number } => ({
      x: Math.min(Math.max(p.x, 0), plan.widthM),
      y: Math.min(Math.max(p.y, 0), plan.heightM),
    }),
    [plan.widthM, plan.heightM],
  );

  const onBackgroundPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (readOnly) return;
    const p = clamp(toMeters(e));
    if (tool === 'wall') {
      setWallDraft({ x1: p.x, y1: p.y, x2: p.x, y2: p.y });
      svgRef.current?.setPointerCapture(e.pointerId);
    } else if (tool === 'ap') {
      onAddAp?.(p.x, p.y);
    } else if (tool === 'measure') {
      onPlacePoint?.(p.x, p.y);
    }
  };

  const onSvgPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragApRef.current;
    if (drag) {
      const p = toMeters(e);
      const next = clamp({ x: p.x - drag.offX, y: p.y - drag.offY });
      onMoveAp?.(drag.id, next.x, next.y);
      return;
    }
    if (wallDraft && tool === 'wall') {
      const p = clamp(toMeters(e));
      setWallDraft((prev) => (prev ? { ...prev, x2: p.x, y2: p.y } : prev));
    }
  };

  const onSvgPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (dragApRef.current) {
      dragApRef.current = null;
      svgRef.current?.releasePointerCapture(e.pointerId);
      return;
    }
    if (wallDraft) {
      const len = Math.hypot(wallDraft.x2 - wallDraft.x1, wallDraft.y2 - wallDraft.y1);
      if (len >= 0.1) {
        onAddWall?.({ ...wallDraft, material: wallMaterial });
      }
      setWallDraft(null);
      svgRef.current?.releasePointerCapture(e.pointerId);
    }
  };

  const onApPointerDown = (e: React.PointerEvent<SVGGElement>, ap: ApPlacement) => {
    if (readOnly || tool !== 'select') return;
    e.stopPropagation();
    const p = toMeters(e);
    dragApRef.current = { id: ap.id, offX: p.x - ap.x, offY: p.y - ap.y };
    svgRef.current?.setPointerCapture(e.pointerId);
  };

  const cursor =
    readOnly || tool === 'select'
      ? 'default'
      : tool === 'ap'
        ? 'copy'
        : 'crosshair';

  const samples = surveySamples ?? [];

  return (
    <div
      ref={wrapRef}
      className="relative w-full overflow-auto rounded-xl border border-kr bg-kr-surface"
    >
      <div className="relative" style={{ width: widthPx, height: heightPx }}>
        {plan.backgroundImage && (
          <img
            src={plan.backgroundImage}
            alt=""
            aria-hidden
            className="pointer-events-none absolute inset-0 h-full w-full object-fill opacity-80"
          />
        )}
        <canvas
          ref={canvasRef}
          className="pointer-events-none absolute inset-0"
          style={{ width: widthPx, height: heightPx }}
        />
        <svg
          ref={svgRef}
          width={widthPx}
          height={heightPx}
          viewBox={`0 0 ${widthPx} ${heightPx}`}
          className="absolute inset-0 touch-none select-none"
          style={{ cursor }}
          role="img"
          aria-label={`Plano ${plan.name}: ${plan.widthM}×${plan.heightM} m con ${accessPoints.length} punto(s) de acceso`}
          onPointerDown={onBackgroundPointerDown}
          onPointerMove={onSvgPointerMove}
          onPointerUp={onSvgPointerUp}
        >
          {/* Rejilla de 1 m para dar sensación de escala. */}
          <MeterGrid widthM={plan.widthM} heightM={plan.heightM} pxPerM={pxPerM} />

          {/* Paredes / obstáculos */}
          {walls.map((w) => (
            <line
              key={w.id}
              x1={w.x1 * pxPerM}
              y1={w.y1 * pxPerM}
              x2={w.x2 * pxPerM}
              y2={w.y2 * pxPerM}
              stroke="var(--kr-text-secondary)"
              strokeWidth={WALL_STROKE_WIDTH[w.material]}
              strokeLinecap="round"
            >
              <title>{WALL_MATERIAL_LABELS[w.material]}</title>
            </line>
          ))}

          {/* Borrador de pared en curso */}
          {wallDraft && (
            <line
              x1={wallDraft.x1 * pxPerM}
              y1={wallDraft.y1 * pxPerM}
              x2={wallDraft.x2 * pxPerM}
              y2={wallDraft.y2 * pxPerM}
              stroke="var(--kr-accent)"
              strokeWidth={WALL_STROKE_WIDTH[wallMaterial]}
              strokeDasharray="4 4"
              strokeLinecap="round"
            />
          )}

          {/* Puntos de medición (survey) */}
          {samples.map((s) => (
            <circle
              key={s.id}
              cx={s.x * pxPerM}
              cy={s.y * pxPerM}
              r={SAMPLE_RADIUS_PX}
              fill={signalQualityColorVar(signalQuality(s.rssiDbm))}
              stroke="var(--kr-bg)"
              strokeWidth={1.5}
            >
              <title>{`${Math.round(s.rssiDbm)} dBm`}</title>
            </circle>
          ))}

          {/* Puntos de acceso (arrastrables) */}
          {accessPoints.map((ap) => (
            <g
              key={ap.id}
              role="button"
              tabIndex={readOnly ? undefined : 0}
              aria-label={`${ap.name} (${Math.round(ap.x)}, ${Math.round(ap.y)} m)`}
              className={readOnly ? undefined : 'cursor-grab active:cursor-grabbing'}
              onPointerDown={(e) => onApPointerDown(e, ap)}
              onClick={() => onSelectAp?.(ap.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelectAp?.(ap.id);
                }
              }}
            >
              <circle
                cx={ap.x * pxPerM}
                cy={ap.y * pxPerM}
                r={AP_RADIUS_PX}
                fill={ap.enabled ? 'var(--kr-accent)' : 'var(--kr-text-muted)'}
                stroke="var(--kr-bg)"
                strokeWidth={2}
              />
              <text
                x={ap.x * pxPerM}
                y={ap.y * pxPerM + AP_RADIUS_PX + 12}
                textAnchor="middle"
                fill="var(--kr-text-primary)"
                fontSize={11}
                className="pointer-events-none"
              >
                {ap.name}
              </text>
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}

/** Rejilla de 1 metro dibujada de forma sutil bajo el resto de capas. */
function MeterGrid({
  widthM,
  heightM,
  pxPerM,
}: {
  widthM: number;
  heightM: number;
  pxPerM: number;
}) {
  // Evita dibujar miles de líneas en planos enormes o escalas diminutas.
  if (pxPerM < 8 || widthM > 200 || heightM > 200) return null;
  const cols = Math.floor(widthM);
  const rows = Math.floor(heightM);
  const lines: React.ReactNode[] = [];
  for (let c = 1; c <= cols; c++) {
    lines.push(
      <line
        key={`v-${c}`}
        x1={c * pxPerM}
        y1={0}
        x2={c * pxPerM}
        y2={heightM * pxPerM}
        stroke="var(--kr-border)"
        strokeWidth={0.5}
        opacity={0.4}
      />,
    );
  }
  for (let r = 1; r <= rows; r++) {
    lines.push(
      <line
        key={`h-${r}`}
        x1={0}
        y1={r * pxPerM}
        x2={widthM * pxPerM}
        y2={r * pxPerM}
        stroke="var(--kr-border)"
        strokeWidth={0.5}
        opacity={0.4}
      />,
    );
  }
  return <g className="pointer-events-none">{lines}</g>;
}
