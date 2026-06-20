import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-kr-sm font-medium',
  {
    variants: {
      variant: {
        default: 'border-kr bg-kr-elevated text-kr-secondary',
        online: 'border-success bg-kr-elevated text-success',
        offline: 'border-kr bg-kr-elevated text-kr-secondary',
        warning: 'border-warning bg-kr-elevated text-warning',
        danger: 'border-danger bg-kr-elevated text-danger',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant, className }))} {...props} />;
}

export { badgeVariants };
