import { Loader2 } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface StepperStep {
  /** Identificador estable del paso. */
  id: string;
  /** Título del paso (encabezado del contenido). */
  title: ReactNode;
  /** Contenido renderizado del paso (solo se muestra el paso activo). */
  content: ReactNode;
  /** Descripción corta opcional bajo el título. */
  description?: ReactNode;
  /** Si es `false`, deshabilita "Siguiente" (gating de validez). Por defecto `true`. */
  canAdvance?: boolean;
  /** Muestra un botón "Omitir" que avanza sin validar. */
  skippable?: boolean;
}

export interface StepperProps {
  /** Pasos ordenados del asistente. */
  steps: StepperStep[];
  /** Índice del paso activo (controlado por el padre). */
  current: number;
  /** Se invoca al pedir cambiar de paso (Atrás/Siguiente/Omitir). El padre decide si aplica. */
  onStepChange: (index: number) => void;
  /** Se invoca al pulsar "Finalizar" en el último paso. */
  onComplete: () => void;
  /** Muestra spinner en "Siguiente"/"Finalizar" y bloquea la navegación mientras corre un async. */
  busy?: boolean;
  backLabel?: string;
  nextLabel?: string;
  finishLabel?: string;
  skipLabel?: string;
  className?: string;
}

/**
 * Contenedor de flujo por pasos (asistente/wizard). Es **controlado**: el padre
 * posee el índice y los datos, de modo que puede correr trabajo asíncrono (una
 * prueba de conexión, p. ej.) entre pasos y reflejarlo con `busy`.
 *
 * Renderiza un indicador de progreso (paso N de M + barra segmentada con estados
 * completado/actual/pendiente), el contenido del paso activo y un pie con
 * Atrás/Siguiente/Finalizar (+ Omitir opcional). El cambio de paso se anuncia a
 * lectores de pantalla mediante una región `aria-live`.
 */
export function Stepper({
  steps,
  current,
  onStepChange,
  onComplete,
  busy = false,
  backLabel = 'Atrás',
  nextLabel = 'Siguiente',
  finishLabel = 'Finalizar',
  skipLabel = 'Omitir',
  className,
}: StepperProps) {
  const titleId = useId();
  const total = steps.length;
  if (total === 0) return null;

  // Acota el índice recibido para no operar nunca fuera de rango.
  const active = Math.min(Math.max(current, 0), total - 1);
  const step = steps[active];
  if (!step) return null;

  const isFirst = active === 0;
  const isLast = active === total - 1;
  const canAdvance = step.canAdvance !== false;

  const goBack = () => onStepChange(active - 1);
  const goNext = () => (isLast ? onComplete() : onStepChange(active + 1));
  const goSkip = () => (isLast ? onComplete() : onStepChange(active + 1));

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      {/* Anuncio para lectores de pantalla al cambiar de paso. */}
      <span className="sr-only" role="status" aria-live="polite">
        Paso {active + 1} de {total}: {step.title}
      </span>

      {/* Indicador de progreso: texto + barra segmentada (decorativa). */}
      <div className="space-y-2">
        <p className="text-kr-sm font-medium text-kr-secondary">
          Paso {active + 1} de {total}
        </p>
        <ol aria-hidden className="flex gap-1.5">
          {steps.map((s, i) => {
            const state = i < active ? 'completed' : i === active ? 'current' : 'upcoming';
            return (
              <li
                key={s.id}
                data-state={state}
                className={cn(
                  'h-1.5 flex-1 rounded-full transition-colors',
                  state === 'upcoming' ? 'bg-kr-elevated' : 'bg-kr-accent',
                  state === 'current' && 'opacity-100',
                  state === 'completed' && 'opacity-70',
                )}
              />
            );
          })}
        </ol>
      </div>

      {/* Contenido del paso activo. */}
      <div role="group" aria-labelledby={titleId} className="min-h-0">
        <h2 id={titleId} className="text-kr-lg font-semibold text-kr-primary">
          {step.title}
        </h2>
        {step.description && (
          <p className="mt-0.5 text-kr-sm text-kr-secondary">{step.description}</p>
        )}
        <div className="mt-3">{step.content}</div>
      </div>

      {/* Pie de navegación. */}
      <footer className="flex items-center justify-between gap-3 pt-2">
        <Button type="button" variant="outline" onClick={goBack} disabled={isFirst || busy}>
          {backLabel}
        </Button>
        <div className="flex items-center gap-2">
          {step.skippable && (
            <Button type="button" variant="ghost" onClick={goSkip} disabled={busy}>
              {skipLabel}
            </Button>
          )}
          <Button
            type="button"
            onClick={goNext}
            disabled={busy || !canAdvance}
            aria-busy={busy}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {isLast ? finishLabel : nextLabel}
          </Button>
        </div>
      </footer>
    </div>
  );
}
