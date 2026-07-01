import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export interface CopyButtonProps {
  /** Texto que se copia al portapapeles. */
  value: string;
  /** Etiqueta accesible en estado normal. Por defecto "Copiar". */
  label?: string;
  /** Etiqueta accesible/visible tras copiar. Por defecto "¡Copiado!". */
  copiedLabel?: string;
  /** Muestra el texto junto al icono (por defecto solo icono). */
  showLabel?: boolean;
  /** Duración del feedback "copiado" en ms (por defecto 1500). */
  feedbackMs?: number;
  /** Callback tras una copia correcta. */
  onCopied?: (value: string) => void;
  className?: string;
}

const DEFAULT_FEEDBACK_MS = 1500;

/**
 * Botón que copia `value` al portapapeles y muestra un feedback efímero
 * (icono Copy → Check + "¡Copiado!") durante ~1.5 s. Degrada con elegancia si
 * el portapapeles no está disponible (contexto no seguro o navegador viejo): no
 * lanza ni deja la UI en un estado inconsistente. Sin dependencias externas.
 */
export function CopyButton({
  value,
  label = 'Copiar',
  copiedLabel = '¡Copiado!',
  showLabel = false,
  feedbackMs = DEFAULT_FEEDBACK_MS,
  onCopied,
  className,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Limpia el temporizador pendiente al desmontar para no llamar setState fuera.
  useEffect(() => () => clearTimeout(timerRef.current), []);

  const handleCopy = async () => {
    // El portapapeles puede no existir (http sin TLS, navegador antiguo).
    if (!navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      onCopied?.(value);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), feedbackMs);
    } catch {
      // Permiso denegado o escritura rechazada: no rompemos la interfaz.
      setCopied(false);
    }
  };

  const Icon = copied ? Check : Copy;

  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      aria-label={copied ? copiedLabel : label}
      data-copied={copied}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-md border border-kr bg-kr-surface px-2 py-1 text-kr-sm text-kr-secondary transition-colors hover:bg-kr-elevated hover:text-kr-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        copied && 'border-success text-success',
        className,
      )}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      {showLabel && <span>{copied ? copiedLabel : label}</span>}
    </button>
  );
}
