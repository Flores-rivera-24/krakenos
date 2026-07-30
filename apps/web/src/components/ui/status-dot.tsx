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
 *
 * ⚠️ **`role="img"`, no `role="status"`** (US-235 / AUD3-26). `status` es una
 * **live region**: el lector de pantalla anuncia cualquier cambio dentro de ella.
 * Con 40 dispositivos en el inventario eso son **40 live regions** parloteando a
 * la vez cada vez que llega un `inventory:device-updated` por socket — el
 * resultado es ruido continuo que hace la lista inservible con lector de
 * pantalla, y de paso ahoga los anuncios que sí importan (los toasts).
 *
 * El punto no es un estado que deba interrumpir: es una **imagen con nombre**.
 * `role="img"` + `aria-label` lo anuncia cuando el usuario llega a él, y calla el
 * resto del tiempo.
 */
export function StatusDot({ status, label, className, ...props }: StatusDotProps) {
  return (
    <span
      role="img"
      aria-label={label ?? STATUS_LABEL[status]}
      data-status={status}
      className={cn('inline-block h-2 w-2 shrink-0 rounded-full', STATUS_BG[status], className)}
      {...props}
    />
  );
}
