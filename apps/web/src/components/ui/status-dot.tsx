import type { HTMLAttributes } from 'react';
import { useT, type TranslationKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export type DotStatus = 'online' | 'offline' | 'warning' | 'danger';

/** Clase de fondo (token semántico) por estado. */
const STATUS_BG: Record<DotStatus, string> = {
  online: 'bg-online',
  offline: 'bg-offline',
  warning: 'bg-warning',
  danger: 'bg-danger',
};

/** Clave de etiqueta accesible por estado. */
const STATUS_LABEL_KEY: Record<DotStatus, TranslationKey> = {
  online: 'ui.statusDot.online',
  offline: 'ui.statusDot.offline',
  warning: 'ui.statusDot.warning',
  danger: 'ui.statusDot.danger',
};

export interface StatusDotProps extends HTMLAttributes<HTMLSpanElement> {
  status: DotStatus;
  /** Etiqueta accesible opcional; por defecto la del estado. */
  label?: string;
}

/**
 * Punto de estado de 8px usado en toda la app (dispositivos, drivers, integraciones).
 * Verde/gris/amarillo/rojo según `status`.
 */
export function StatusDot({ status, label, className, ...props }: StatusDotProps) {
  const t = useT();
  return (
    <span
      role="status"
      aria-label={label ?? t(STATUS_LABEL_KEY[status])}
      data-status={status}
      className={cn('inline-block h-2 w-2 shrink-0 rounded-full', STATUS_BG[status], className)}
      {...props}
    />
  );
}
