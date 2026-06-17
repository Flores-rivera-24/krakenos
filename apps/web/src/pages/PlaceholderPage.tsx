import { Construction } from 'lucide-react';

interface PlaceholderPageProps {
  title: string;
  description?: string;
}

/** Página temporal para secciones del MVP aún no implementadas. */
export function PlaceholderPage({ title, description }: PlaceholderPageProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-12 text-center">
      <Construction className="h-10 w-10 text-muted-foreground" />
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="max-w-sm text-sm text-muted-foreground">
        {description ?? 'Esta sección está en construcción.'}
      </p>
    </div>
  );
}
