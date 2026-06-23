import type { ReactNode } from 'react';
import { StatusDot } from '@/components/ui/status-dot';

/**
 * Banner de error accesible (`role="alert"`) — extrae el patrón que US-55 estrenó
 * en Ajustes para reutilizarlo en todas las páginas (US-93). Tokens kr-* (sin
 * colores hardcodeados). El lector de pantalla lo anuncia al aparecer.
 */
export function ErrorBanner({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="flex items-center gap-2 rounded-md border border-danger bg-kr-elevated px-3 py-2 text-kr-sm text-danger"
    >
      <StatusDot status="danger" />
      {children}
    </div>
  );
}
