import { cva, type VariantProps } from 'class-variance-authority';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

const calloutVariants = cva('flex gap-3 rounded-md border bg-kr-elevated px-3 py-2.5 text-kr-sm', {
  variants: {
    variant: {
      info: 'border-info',
      success: 'border-success',
      warning: 'border-warning',
      danger: 'border-danger',
    },
  },
  defaultVariants: { variant: 'info' },
});

type CalloutVariant = NonNullable<VariantProps<typeof calloutVariants>['variant']>;

/** Icono por variante (lucide). */
const ICONS: Record<CalloutVariant, typeof Info> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
};

/** Color del icono por variante (token semántico). */
const ICON_COLOR: Record<CalloutVariant, string> = {
  info: 'text-info',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
};

/**
 * Rol ARIA por variante: info/success/warning son notas (`note`); danger se
 * anuncia como alerta (`alert`) por ser un error accionable.
 */
const ROLE: Record<CalloutVariant, 'note' | 'alert'> = {
  info: 'note',
  success: 'note',
  warning: 'note',
  danger: 'alert',
};

export interface CalloutProps extends VariantProps<typeof calloutVariants> {
  /** Título opcional en negrita. */
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
  /**
   * `true` cuando el aviso es **permanente** (una advertencia que siempre está
   * ahí), no algo que acaba de pasar.
   *
   * `role="alert"` es una live region **asertiva**: interrumpe al lector de
   * pantalla. Es correcto para «la operación falló», y equivocado para «esto es
   * peligroso», que lleva en la página desde que se cargó — se anunciaría al
   * montar, competiría con los errores de verdad y, si hay dos en la misma
   * pantalla, ni siquiera se puede localizar «el» alert (US-235). En ese caso se
   * degrada a `note`, que se lee al llegar y calla el resto del tiempo.
   */
  standing?: boolean;
}

/**
 * Caja de nota con variantes `info | success | warning | danger`, cada una con
 * su icono y color semántico. Usa solo tokens `kr-*`/semánticos. `role="note"`
 * salvo `danger`, que usa `role="alert"` — salvo que se marque `standing`, para
 * advertencias permanentes que no deben interrumpir (ver la prop).
 */
export function Callout({ variant, title, children, className, standing }: CalloutProps) {
  const key: CalloutVariant = variant ?? 'info';
  const Icon = ICONS[key];
  return (
    <div role={standing ? 'note' : ROLE[key]} className={cn(calloutVariants({ variant, className }))}>
      <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', ICON_COLOR[key])} aria-hidden />
      <div className="min-w-0 space-y-1">
        {title && <p className="font-semibold text-kr-primary">{title}</p>}
        {children && <div className="text-kr-secondary">{children}</div>}
      </div>
    </div>
  );
}

export { calloutVariants };
