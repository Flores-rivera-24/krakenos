import { ArtSvg, type ArtProps } from './shared';

/** Ordenador portátil. */
export function LaptopArt({ className, title }: ArtProps) {
  return (
    <ArtSvg className={className} title={title}>
      {/* pantalla */}
      <rect x={14} y={13} width={36} height={25} rx={2.5} fill="var(--kr-art-shell)" stroke="var(--kr-art-edge)" strokeWidth={1.2} />
      <rect x={17} y={16} width={30} height={19} rx={1.5} fill="var(--kr-art-screen)" />
      <rect x={19} y={18} width={14} height={3} rx={1.5} fill="var(--kr-art-glow)" opacity={0.5} />
      {/* base / teclado */}
      <path d="M9 41 H55 L58 48 H6 Z" fill="var(--kr-art-shell-hi)" stroke="var(--kr-art-edge)" strokeWidth={1.2} strokeLinejoin="round" />
      <rect x={26} y={42.5} width={12} height={2} rx={1} fill="var(--kr-art-shell-lo)" />
    </ArtSvg>
  );
}

/** Teléfono móvil. */
export function PhoneArt({ className, title }: ArtProps) {
  return (
    <ArtSvg className={className} title={title}>
      <rect x={22} y={9} width={20} height={46} rx={5} fill="var(--kr-art-shell)" stroke="var(--kr-art-edge)" strokeWidth={1.2} />
      <rect x={24.5} y={13} width={15} height={34} rx={2} fill="var(--kr-art-screen)" />
      <rect x={29} y={11} width={6} height={1.6} rx={0.8} fill="var(--kr-art-shell-lo)" />
      <rect x={27} y={16} width={9} height={2.5} rx={1.25} fill="var(--kr-art-glow)" opacity={0.5} />
      <rect x={29} y={50} width={6} height={1.6} rx={0.8} fill="var(--kr-art-shell-hi)" />
    </ArtSvg>
  );
}

/** Tablet. */
export function TabletArt({ className, title }: ArtProps) {
  return (
    <ArtSvg className={className} title={title}>
      <rect x={16} y={10} width={32} height={44} rx={4} fill="var(--kr-art-shell)" stroke="var(--kr-art-edge)" strokeWidth={1.2} />
      <rect x={19} y={15} width={26} height={34} rx={2} fill="var(--kr-art-screen)" />
      <rect x={22} y={18} width={13} height={3} rx={1.5} fill="var(--kr-art-glow)" opacity={0.5} />
      <circle cx={32} cy={51.5} r={1.4} fill="var(--kr-art-shell-hi)" />
    </ArtSvg>
  );
}

/** Televisor / pantalla. */
export function TvArt({ className, title }: ArtProps) {
  return (
    <ArtSvg className={className} title={title}>
      <rect x={8} y={12} width={48} height={30} rx={3} fill="var(--kr-art-shell)" stroke="var(--kr-art-edge)" strokeWidth={1.2} />
      <rect x={11} y={15} width={42} height={24} rx={1.5} fill="var(--kr-art-screen)" />
      <rect x={14} y={18} width={16} height={3} rx={1.5} fill="var(--kr-art-glow)" opacity={0.5} />
      <rect x={29} y={42} width={6} height={5} fill="var(--kr-art-metal-lo)" />
      <rect x={22} y={47} width={20} height={3} rx={1.5} fill="var(--kr-art-metal)" />
    </ArtSvg>
  );
}

/** Impresora. */
export function PrinterArt({ className, title }: ArtProps) {
  return (
    <ArtSvg className={className} title={title}>
      {/* bandeja superior */}
      <rect x={20} y={12} width={24} height={10} rx={1.5} fill="var(--kr-art-shell-hi)" stroke="var(--kr-art-edge)" strokeWidth={1} />
      {/* cuerpo */}
      <rect x={12} y={22} width={40} height={22} rx={3} fill="var(--kr-art-shell)" stroke="var(--kr-art-edge)" strokeWidth={1.2} />
      <rect x={15} y={25} width={22} height={4} rx={2} fill="var(--kr-art-shell-hi)" opacity={0.5} />
      <circle cx={46} cy={28} r={1.6} fill="var(--kr-art-glow)" />
      {/* ranura de salida */}
      <rect x={18} y={40} width={28} height={3} rx={1.5} fill="var(--kr-art-screen)" />
      {/* hoja saliendo */}
      <rect x={22} y={43} width={20} height={9} rx={1} fill="var(--kr-art-glass)" stroke="var(--kr-art-edge)" strokeWidth={1} />
      <path d="M25 47 H39 M25 49.5 H35" stroke="var(--kr-art-metal-lo)" strokeWidth={1} />
    </ArtSvg>
  );
}

/** Dispositivo IoT / smart genérico — microchip con pines. */
export function IotHubArt({ className, title }: ArtProps) {
  return (
    <ArtSvg className={className} title={title}>
      {/* pines */}
      <g stroke="var(--kr-art-metal)" strokeWidth={2} strokeLinecap="round">
        <path d="M24 14 V18 M32 14 V18 M40 14 V18" />
        <path d="M24 46 V50 M32 46 V50 M40 46 V50" />
        <path d="M14 24 H18 M14 32 H18 M14 40 H18" />
        <path d="M46 24 H50 M46 32 H50 M46 40 H50" />
      </g>
      {/* chip */}
      <rect x={18} y={18} width={28} height={28} rx={4} fill="var(--kr-art-shell)" stroke="var(--kr-art-edge)" strokeWidth={1.2} />
      <rect x={21} y={21} width={22} height={7} rx={2} fill="var(--kr-art-shell-hi)" opacity={0.5} />
      {/* núcleo */}
      <rect x={26} y={26} width={12} height={12} rx={2} fill="var(--kr-art-screen)" />
      <circle cx={32} cy={32} r={3} fill="var(--kr-art-glow)" />
    </ArtSvg>
  );
}

/** Dispositivo sin identificar. */
export function UnknownArt({ className, title }: ArtProps) {
  return (
    <ArtSvg className={className} title={title}>
      <rect x={16} y={14} width={32} height={36} rx={5} fill="var(--kr-art-shell)" stroke="var(--kr-art-edge)" strokeWidth={1.2} />
      <rect x={19} y={17} width={26} height={8} rx={3} fill="var(--kr-art-shell-hi)" opacity={0.5} />
      <path
        d="M27 31 A5 5 0 1 1 32 36 L32 39"
        stroke="var(--kr-art-glow)"
        strokeWidth={2.4}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={32} cy={44} r={1.8} fill="var(--kr-art-glow)" />
    </ArtSvg>
  );
}
