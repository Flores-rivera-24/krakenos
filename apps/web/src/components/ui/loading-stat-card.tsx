import type { LucideIcon } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface LoadingStatCardProps {
  title: string;
  icon: LucideIcon;
  accent?: string;
  hint?: string;
}

/**
 * La `StatCard` mientras llega su cifra: un esqueleto en el sitio del valor.
 * «—» queda para «dato no disponible»; pintarlo mientras se carga dice lo contrario.
 */
export function LoadingStatCard({
  title,
  icon: Icon,
  accent = 'text-primary',
  hint,
}: LoadingStatCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle>{title}</CardTitle>
        <Icon className={cn('h-4 w-4', accent)} />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-8 w-24" />
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}
