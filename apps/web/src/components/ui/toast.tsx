import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import { useEffect } from 'react';
import { cn } from '@/lib/utils';
import { type Toast, type ToastKind, useToastStore } from '@/store/toast.store';

const TOAST_TTL_MS = 4000;

const ICONS: Record<ToastKind, typeof CheckCircle2> = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
};

const ACCENT: Record<ToastKind, string> = {
  success: 'border-success text-success',
  error: 'border-danger text-danger',
  info: 'border-kr text-kr-secondary',
};

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useToastStore((s) => s.dismiss);
  const Icon = ICONS[toast.kind];

  // Auto-descarte: la acción del store es estable y el id no cambia, así que el
  // temporizador se programa una sola vez por toast.
  useEffect(() => {
    const timer = setTimeout(() => dismiss(toast.id), TOAST_TTL_MS);
    return () => clearTimeout(timer);
  }, [toast.id, dismiss]);

  return (
    <div
      className={cn(
        'pointer-events-auto flex items-start gap-2 rounded-md border bg-kr-surface px-3 py-2 text-kr-sm shadow-lg',
        ACCENT[toast.kind],
      )}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span className="flex-1 text-kr-primary">{toast.message}</span>
      <button
        type="button"
        aria-label="Descartar"
        onClick={() => dismiss(toast.id)}
        className="shrink-0 text-kr-muted hover:text-kr-primary"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

/**
 * Región de toasts montada una vez en `AppLayout` (US-96). `aria-live="polite"`
 * para que el lector de pantalla anuncie el resultado sin robar el foco; no usa
 * `role="alert"` para no colisionar con el `ErrorBanner` de carga (US-93).
 */
export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  if (toasts.length === 0) return null;
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-full max-w-sm flex-col gap-2"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  );
}
