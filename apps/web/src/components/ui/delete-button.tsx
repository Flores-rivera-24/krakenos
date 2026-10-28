import { Loader2 } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, type ButtonProps } from '@/components/ui/button';
import { useT } from '@/lib/i18n';

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
  /** Deshabilita el botón (p. ej. mientras otra operación sobre la misma fila está en vuelo). */
  disabled?: boolean;
}

/** Tiempo tras el que «Confirmar» vuelve a su estado normal. */
const DESARMAR_MS = 10000;

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
 * Se **desarma solo** a los 10 s: dejarlo armado indefinidamente convierte un
 * click distraído un minuto después en un borrado, y menos tiempo no le alcanza
 * a quien lee la pregunta con lector de pantalla o teclea despacio. Al desarmarse
 * (por tiempo o con «Cancelar») el foco vuelve al botón original solo si estaba
 * dentro de la confirmación: el `<span>` armado se desmonta y el foco caería en
 * `<body>`, pero si el usuario ya se fue a otro control no se le arrebata.
 */
export function DeleteButton({
  onDelete,
  children,
  variant = 'ghost',
  className,
  skipConfirm,
  disabled,
  ...rest
}: Props) {
  const t = useT();
  const [pending, setPending] = useState(false);
  const [armado, setArmado] = useState(false);
  const confirmarRef = useRef<HTMLButtonElement>(null);
  const originalRef = useRef<HTMLButtonElement>(null);
  const grupoRef = useRef<HTMLSpanElement>(null);
  const devolverFoco = useRef(false);

  // Se decide ANTES de que React desmonte el grupo: después, el foco ya está en <body>.
  const desarmar = () => {
    devolverFoco.current = grupoRef.current?.contains(document.activeElement) ?? false;
    setArmado(false);
  };

  // Al armar, el foco va a «Confirmar»: con teclado la acción continúa donde
  // estaba en vez de perderse, y el lector de pantalla lee el botón nuevo.
  useEffect(() => {
    if (armado) confirmarRef.current?.focus();
  }, [armado]);

  useEffect(() => {
    if (armado || !devolverFoco.current) return;
    devolverFoco.current = false;
    originalRef.current?.focus();
  }, [armado]);

  useEffect(() => {
    if (!armado) return;
    const id = setTimeout(desarmar, DESARMAR_MS);
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
      <span
        ref={grupoRef}
        role="group"
        aria-label={rest['aria-label']}
        className="inline-flex items-center gap-1"
      >
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
          {t('common.confirm')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            desarmar();
          }}
        >
          {t('common.cancel')}
        </Button>
      </span>
    );
  }

  return (
    <Button
      ref={originalRef}
      type="button"
      variant={variant}
      size="sm"
      disabled={pending || disabled}
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
