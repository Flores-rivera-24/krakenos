import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ArtProps } from './shared';

/**
 * Emblema de "módulo" para integraciones que no son un aparato físico (VPN, DNS,
 * firewall, QoS, demo): un chasis 2.5D con halo de acento y el glifo lucide de la
 * función. Mantiene la coherencia con las ilustraciones de producto sin tener que
 * dibujar metáforas abstractas. El `className` fija el tamaño (clases h-* y w-*).
 */
export function ServiceEmblem({
  icon: Icon,
  className,
  title,
}: ArtProps & { icon: LucideIcon }) {
  return (
    <span
      className={cn('relative inline-flex shrink-0 items-center justify-center', className)}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <svg viewBox="0 0 64 64" fill="none" className="h-full w-full" aria-hidden="true" focusable="false">
        <rect x={8} y={8} width={48} height={48} rx={13} fill="var(--kr-art-shell)" stroke="var(--kr-art-edge)" strokeWidth={1.2} />
        <rect x={12} y={12} width={40} height={16} rx={9} fill="var(--kr-art-shell-hi)" opacity={0.45} />
        <rect x={8} y={8} width={48} height={48} rx={13} fill="none" stroke="var(--kr-art-glow)" strokeWidth={1} opacity={0.5} />
      </svg>
      <Icon className="absolute h-[42%] w-[42%] text-kr-accent" strokeWidth={2} aria-hidden />
    </span>
  );
}
