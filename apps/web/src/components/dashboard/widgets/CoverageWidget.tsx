import type { CoverageHeatmap, FloorPlan, SignalQuality } from '@krakenos/types';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getPredictedHeatmap, listFloorPlans } from '@/lib/coverage';
import { SIGNAL_QUALITY_LABELS, signalQuality, signalQualityColorVar } from '@/lib/coverage-format';

/** Categorías en orden de mejor a peor, para la barra de distribución. */
const QUALITIES: SignalQuality[] = ['excellent', 'good', 'fair', 'weak', 'none'];

/**
 * Resumen de cobertura WiFi en el dashboard (US-158): calcula la predicción del
 * primer plano en 5 GHz y muestra el % de superficie con señal aceptable o
 * mejor, con una barra de distribución por calidad. Enlaza a la página completa.
 */
export function CoverageWidget() {
  // `undefined` = cargando · `null` = sin planos.
  const [plan, setPlan] = useState<FloorPlan | null | undefined>(undefined);
  const [heatmap, setHeatmap] = useState<CoverageHeatmap | null>(null);

  useEffect(() => {
    let active = true;
    void listFloorPlans()
      .then((plans) => {
        if (!active) return;
        const first = plans[0] ?? null;
        setPlan(first);
        if (first) {
          return getPredictedHeatmap(first.id, '5GHz').then((h) => {
            if (active) setHeatmap(h);
          });
        }
        return undefined;
      })
      .catch(() => {
        if (active) setPlan(null);
      });
    return () => {
      active = false;
    };
  }, []);

  // Distribución de calidad sobre las celdas con dato.
  const counts: Record<SignalQuality, number> = {
    excellent: 0,
    good: 0,
    fair: 0,
    weak: 0,
    none: 0,
  };
  let covered = 0;
  if (heatmap) {
    for (const v of heatmap.values) {
      if (v === null) continue;
      counts[signalQuality(v)] += 1;
      covered += 1;
    }
  }
  const okPct =
    covered > 0
      ? Math.round(((counts.excellent + counts.good + counts.fair) / covered) * 100)
      : 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>Cobertura WiFi</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {plan === undefined ? (
          <p className="py-4 text-center text-kr-sm text-kr-muted">Cargando…</p>
        ) : plan === null ? (
          <div className="space-y-2 py-2">
            <p className="text-kr-sm text-kr-muted">
              Crea un plano de tu casa para ver el mapa de calor de tu WiFi.
            </p>
            <Link to="/coverage" className="inline-block text-kr-sm text-kr-link hover:underline">
              Crear plano →
            </Link>
          </div>
        ) : !heatmap || covered === 0 ? (
          <div className="space-y-2 py-2">
            <p className="text-kr-sm text-kr-muted">
              Coloca tus puntos de acceso en «{plan.name}» para calcular la cobertura.
            </p>
            <Link to="/coverage" className="inline-block text-kr-sm text-kr-link hover:underline">
              Ver cobertura →
            </Link>
          </div>
        ) : (
          <>
            <div>
              <p className="text-2xl font-semibold text-kr-primary">{okPct}%</p>
              <p className="text-kr-xs text-kr-muted">
                con señal aceptable o mejor · {plan.name} · 5 GHz
              </p>
            </div>
            <div
              className="flex h-2 overflow-hidden rounded-full bg-kr-elevated"
              role="img"
              aria-label={`Distribución de cobertura: ${okPct}% con señal aceptable o mejor`}
            >
              {QUALITIES.map((q) =>
                counts[q] > 0 ? (
                  <span
                    key={q}
                    style={{
                      width: `${(counts[q] / covered) * 100}%`,
                      backgroundColor: signalQualityColorVar(q),
                    }}
                    title={`${SIGNAL_QUALITY_LABELS[q]}: ${Math.round((counts[q] / covered) * 100)}%`}
                  />
                ) : null,
              )}
            </div>
            <Link to="/coverage" className="inline-block text-kr-sm text-kr-link hover:underline">
              Ver mapa de calor →
            </Link>
          </>
        )}
      </CardContent>
    </Card>
  );
}
