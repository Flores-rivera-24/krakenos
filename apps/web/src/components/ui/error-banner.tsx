import type { ReactNode } from 'react';
import { StatusDot } from '@/components/ui/status-dot';

/** `role="alert"`: el lector de pantalla lo anuncia al aparecer. */
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
