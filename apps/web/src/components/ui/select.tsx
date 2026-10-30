import { forwardRef, type SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        'flex min-h-11 md:min-h-0 h-10 w-full rounded-md border border-kr-field bg-background px-3 py-2 text-base md:text-sm text-kr-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-kr-ring disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Select.displayName = 'Select';
