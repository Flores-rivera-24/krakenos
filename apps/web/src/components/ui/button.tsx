import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-kr-accent text-white hover:bg-kr-accent-hover',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        outline: 'border border-kr bg-transparent text-kr-primary hover:bg-kr-elevated',
        ghost: 'text-kr-primary hover:bg-kr-elevated',
      },
      // US-235: objetivos táctiles de 44 px en móvil (WCAG 2.5.8 pide 24 y las
      // guías de iOS/Android recomiendan 44-48). En pantallas con puntero fino se
      // vuelve a las alturas compactas, que es donde la densidad estilo UniFi
      // importa y donde el ratón no falla. `sm` era 36 px: se toca mal con el
      // pulgar, y es el tamaño de los botones de borrar de cada fila.
      size: {
        default: 'min-h-11 px-4 py-2 md:h-10 md:min-h-0',
        sm: 'min-h-11 px-3 md:h-9 md:min-h-0',
        icon: 'h-11 w-11 md:h-10 md:w-10',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size, className }))} {...props} />
  ),
);
Button.displayName = 'Button';

export { buttonVariants };
