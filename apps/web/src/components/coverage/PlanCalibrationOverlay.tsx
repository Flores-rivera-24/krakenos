import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { computeCalibration } from '@/lib/coverage-import';
import { useT } from '@/lib/i18n';

interface Props {
  /** Data URL de la imagen del plano ya importada. */
  image: string;
  /** Aplica las dimensiones calculadas al formulario. */
  onApply: (widthM: number, heightM: number) => void;
  onCancel: () => void;
}

/** Punto en el espacio de píxeles NATURAL de la imagen. */
interface Point {
  x: number;
  y: number;
}

/**
 * Calibración de escala (US-194): el usuario traza una línea sobre algo de medida
 * conocida y teclea cuánto mide; de ahí se derivan el ancho/alto reales del plano
 * (antes se tecleaban a ciegas). Trabaja en píxeles naturales de la imagen, así el
 * resultado no depende del tamaño de visualización.
 */
export function PlanCalibrationOverlay({ image, onApply, onCancel }: Props) {
  const t = useT();
  const imgRef = useRef<HTMLImageElement>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [points, setPoints] = useState<Point[]>([]);
  const [meters, setMeters] = useState('');

  const onImgLoad = () => {
    const img = imgRef.current;
    if (img?.naturalWidth) setNatural({ w: img.naturalWidth, h: img.naturalHeight });
  };

  const addPoint = (e: React.MouseEvent) => {
    const img = imgRef.current;
    if (!img || !natural) return;
    const rect = img.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const x = ((e.clientX - rect.left) / rect.width) * natural.w;
    const y = ((e.clientY - rect.top) / rect.height) * natural.h;
    // Cada tercer clic reinicia la línea.
    setPoints((prev) => (prev.length >= 2 ? [{ x, y }] : [...prev, { x, y }]));
  };

  const refPixels =
    points.length === 2
      ? Math.hypot(points[1]!.x - points[0]!.x, points[1]!.y - points[0]!.y)
      : 0;
  const m = Number(meters);
  const canApply = points.length === 2 && refPixels > 0 && Number.isFinite(m) && m > 0 && !!natural;

  const apply = () => {
    if (!canApply || !natural) return;
    const { widthM, heightM } = computeCalibration(refPixels, m, natural.w, natural.h);
    onApply(widthM, heightM);
  };

  // Convierte un punto natural a porcentaje para el overlay SVG.
  const pct = (p: Point) => (natural ? { x: (p.x / natural.w) * 100, y: (p.y / natural.h) * 100 } : { x: 0, y: 0 });

  return (
    <div className="space-y-3">
      <p className="text-kr-xs text-kr-muted">{t('coverage.calibrate.hint')}</p>

      <div className="relative select-none">
        <img
          ref={imgRef}
          src={image}
          alt={t('coverage.import.preview')}
          onLoad={onImgLoad}
          onClick={addPoint}
          className="w-full cursor-crosshair rounded-md border border-kr object-contain"
        />
        {/* Overlay de la línea de referencia y sus extremos. */}
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-0 h-full w-full"
        >
          {points.length === 2 && (
            <line
              x1={pct(points[0]!).x}
              y1={pct(points[0]!).y}
              x2={pct(points[1]!).x}
              y2={pct(points[1]!).y}
              stroke="var(--kr-accent)"
              strokeWidth={0.6}
            />
          )}
          {points.map((p, i) => {
            const c = pct(p);
            return <circle key={i} cx={c.x} cy={c.y} r={1} fill="var(--kr-accent)" />;
          })}
        </svg>
      </div>

      {points.length < 2 && <p className="text-kr-xs text-warning">{t('coverage.calibrate.needLine')}</p>}

      <div className="space-y-2">
        <Label htmlFor="calib-m">{t('coverage.calibrate.meters')}</Label>
        <Input
          id="calib-m"
          type="number"
          min={0}
          step={0.1}
          value={meters}
          onChange={(e) => setMeters(e.target.value)}
        />
      </div>

      <div className="flex gap-2">
        <Button size="sm" disabled={!canApply} onClick={apply}>
          {t('coverage.calibrate.apply')}
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel}>
          {t('coverage.calibrate.cancel')}
        </Button>
      </div>
    </div>
  );
}
