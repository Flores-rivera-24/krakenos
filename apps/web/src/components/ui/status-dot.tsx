import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export type DotStatus = 'online' | 'offline' | 'warning' | 'danger';

/** Clase de fondo (token semántico) por estado. */
const STATUS_BG: Record<DotStatus, string> = {
  online: 'bg-online',
  offline: 'bg-offline',
  warning: 'bg-warning',
  danger: 'bg-danger',
};

/** Etiqueta accesible por estado. */
const STATUS_LABEL: Record<DotStatus, string> = {
  online: 'En línea',
  offline: 'Desconectado',
  warning: 'Advertencia',
  danger: 'Error',
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
  return (
    <span
      role="status"
      aria-label={label ?? STATUS_LABEL[status]}
      data-status={status}
      className={cn('inline-block h-2 w-2 shrink-0 rounded-full', STATUS_BG[status], className)}
      {...props}
    />
  );
}
