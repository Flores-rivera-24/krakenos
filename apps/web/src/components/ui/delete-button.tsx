import { Loader2 } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, type ButtonProps } from '@/components/ui/button';

interface Props {
  /** Acción de borrado. La fila puede desmontarse al recargar la lista tras resolver. */
  onDelete: () => Promise<unknown>;
  children: ReactNode;
  variant?: ButtonProps['variant'];
  className?: string;
  'aria-label'?: string;
  /**
   * Desactiva la confirmación de dos pasos. Solo para borrados **triviales y
   * reversibles** (p. ej. quitar algo de una lista en memoria que aún no se ha
   * guardado). Si estás dudando, no lo pongas.
   */
  skipConfirm?: boolean;
}

/** Tiempo tras el que «Confirmar» vuelve a su estado normal. */
const DESARMAR_MS = 5000;

/**
 * Botón de borrado con **confirmación de dos pasos** y estado pendiente por fila.
 *
 * - **Pendiente** (US-96): se deshabilita y muestra un spinner mientras la
 *   petición está en vuelo, así dos borrados seguidos no se pisan ni parecen
 *   colgados. Detiene la propagación para no disparar el click de su fila.
 * - **Confirmación** (US-235 / AUD3-29): la auditoría contó **11 borrados que no
 *   confirmaban nada** — un toque y el peer de VPN, la regla de firewall o la
 *   escena desaparecían. Al ser un componente compartido, arreglarlo aquí los
 *   cubre los once de golpe. Se usa el patrón que ya existía en `SecuritySection`
 *   (Confirmar + Cancelar explícitos) en vez de «pulsa dos veces el mismo botón»,
 *   que es ambiguo con lector de pantalla: el nombre del control cambiaría bajo
 *   el dedo sin avisar.
 *
 * Se **desarma solo** a los 5 s: dejarlo armado indefinidamente convierte un
 * click distraído un minuto después en un borrado.
 */
export function DeleteButton({
  onDelete,
  children,
  variant = 'ghost',
  className,
  skipConfirm,
  ...rest
}: Props) {
  const [pending, setPending] = useState(false);
  const [armado, setArmado] = useState(false);
  const confirmarRef = useRef<HTMLButtonElement>(null);

  // Al armar, el foco va a «Confirmar»: con teclado la acción continúa donde
  // estaba en vez de perderse, y el lector de pantalla lee el botón nuevo.
  useEffect(() => {
    if (armado) confirmarRef.current?.focus();
  }, [armado]);

  useEffect(() => {
    if (!armado) return;
    const id = setTimeout(() => setArmado(false), DESARMAR_MS);
    return () => clearTimeout(id);
  }, [armado]);

  const handle = async () => {
    if (pending) return;
    setPending(true);
    setArmado(false);
    try {
      await onDelete();
    } finally {
      // Si la lista se recarga, esta fila se desmonta; el setState es un no-op
      // tolerado. Si falla (el handler captura y avisa), reactiva para reintentar.
      setPending(false);
    }
  };

  if (armado && !pending) {
    return (
      <span className="inline-flex items-center gap-1">
        <Button
          ref={confirmarRef}
          type="button"
          variant="destructive"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            void handle();
          }}
        >
          Confirmar
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            setArmado(false);
          }}
        >
          Cancelar
        </Button>
      </span>
    );
  }

  return (
    <Button
      type="button"
      variant={variant}
      size="sm"
      disabled={pending}
      aria-busy={pending}
      aria-label={rest['aria-label']}
      onClick={(e) => {
        e.stopPropagation();
        if (skipConfirm) void handle();
        else setArmado(true);
      }}
      className={className}
    >
      {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </Button>
  );
}
