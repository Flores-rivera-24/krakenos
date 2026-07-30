import { LogoMark } from '@/components/ui/logo';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';

/**
 * Pantalla de carga de marca (US-160) — reemplaza el texto plano "Cargando…".
 * El isotipo Orbital late dentro de un anillo que gira, con ondas de radar que se
 * expanden y una barra de progreso con shimmer. Fondo con rejilla técnica sutil.
 *
 * Usada como fallback de `Suspense` (cambio de ruta) y durante el bootstrap de
 * sesión. `fullScreen={false}` la encaja dentro de un contenedor (p. ej. el área
 * de contenido) para transiciones entre páginas sin tapar la barra lateral.
 *
 * Todo el movimiento respeta prefers-reduced-motion (los anillos quedan quietos).
 */
export interface SplashProps {
  label?: string;
  fullScreen?: boolean;
  className?: string;
}

export function Splash({ label, fullScreen = true, className }: SplashProps) {
  const t = useT();
  const texto = label ?? t('ui.loading');
  return (
    <div
      role="status"
      aria-label={texto}
      className={cn(
        'relative flex flex-col items-center justify-center gap-7 overflow-hidden bg-kr-base',
        fullScreen ? 'min-h-screen' : 'min-h-[60vh] w-full',
        'animate-kr-fade-in',
        className,
      )}
    >
      {/* Rejilla técnica de fondo, desvanecida hacia los bordes. */}
      <div aria-hidden className="kr-grid-bg pointer-events-none absolute inset-0 opacity-60" />

      {/* Isotipo + anillos */}
      <div className="relative flex h-24 w-24 items-center justify-center">
        {/* Ondas de radar que se expanden. */}
        <span
          aria-hidden
          className="absolute inset-0 rounded-full border border-kr-accent-glow animate-kr-pulse-ring"
        />
        <span
          aria-hidden
          className="absolute inset-0 rounded-full border border-kr-accent-glow animate-kr-pulse-ring [animation-delay:1.1s]"
        />
        {/* Órbita discontinua girando. */}
        <span
          aria-hidden
          className="absolute inset-0 rounded-full border-2 border-dashed border-kr-accent-glow animate-kr-orbit-slow"
        />
        <LogoMark className="relative h-12 w-12 text-kr-accent animate-kr-glow" />
      </div>

      {/* Wordmark + barra de progreso indeterminada. */}
      <div className="relative flex flex-col items-center gap-3">
        <span className="text-kr-lg font-semibold tracking-tight text-kr-primary">KrakenOS</span>
        <div className="h-1 w-44 overflow-hidden rounded-full bg-kr-elevated">
          <div aria-hidden className="kr-shimmer h-full w-full rounded-full" />
        </div>
        <span className="text-kr-xs text-kr-muted">{texto}</span>
      </div>
    </div>
  );
}
