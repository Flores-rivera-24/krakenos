import { ArtSvg, type ArtProps } from './shared';

/** Router / gateway doméstico con antenas y LEDs de enlace. */
export function RouterArt({ className, title }: ArtProps) {
  return (
    <ArtSvg className={className} title={title}>
      {/* antenas */}
      <g stroke="var(--kr-art-metal)" strokeWidth={3} strokeLinecap="round">
        <path d="M22 31 L17 11" />
        <path d="M42 31 L47 11" />
      </g>
      <circle cx={17} cy={10} r={2.6} fill="var(--kr-art-metal-lo)" />
      <circle cx={47} cy={10} r={2.6} fill="var(--kr-art-metal-lo)" />
      {/* cuerpo */}
      <rect
        x={9}
        y={30}
        width={46}
        height={20}
        rx={4}
        fill="var(--kr-art-shell)"
        stroke="var(--kr-art-edge)"
        strokeWidth={1.2}
      />
      {/* banda superior (highlight) */}
      <rect x={12} y={32} width={40} height={5} rx={2.5} fill="var(--kr-art-shell-hi)" />
      {/* sombra base */}
      <rect x={13} y={49} width={38} height={3} rx={1.5} fill="var(--kr-art-shell-lo)" opacity={0.9} />
      {/* LEDs (uno activo en acento) */}
      <circle cx={18} cy={44} r={2} fill="var(--kr-art-glow)" />
      <circle cx={26} cy={44} r={2} fill="var(--kr-art-metal)" />
      <circle cx={34} cy={44} r={2} fill="var(--kr-art-metal)" />
    </ArtSvg>
  );
}

/** Punto de acceso de techo (estilo UniFi) con el anillo LED característico. */
export function AccessPointArt({ className, title }: ArtProps) {
  return (
    <ArtSvg className={className} title={title}>
      <circle
        cx={32}
        cy={32}
        r={22}
        fill="var(--kr-art-shell-hi)"
        stroke="var(--kr-art-edge)"
        strokeWidth={1.2}
      />
      <circle cx={32} cy={32} r={17} fill="var(--kr-art-shell)" />
      {/* anillo LED de señal */}
      <circle cx={32} cy={32} r={9.5} fill="none" stroke="var(--kr-art-glow)" strokeWidth={2.6} />
      <circle cx={32} cy={32} r={4.5} fill="var(--kr-art-shell-lo)" />
      {/* brillo superior */}
      <path
        d="M18 25 A20 20 0 0 1 46 25"
        fill="none"
        stroke="var(--kr-art-metal)"
        strokeWidth={1.4}
        strokeLinecap="round"
        opacity={0.45}
      />
    </ArtSvg>
  );
}

const SWITCH_PORTS = [11, 18, 25, 32, 39, 46];

/** Switch de red gestionado — hilera de puertos con LEDs de enlace. */
export function SwitchArt({ className, title }: ArtProps) {
  return (
    <ArtSvg className={className} title={title}>
      <rect
        x={6}
        y={22}
        width={52}
        height={20}
        rx={3}
        fill="var(--kr-art-shell)"
        stroke="var(--kr-art-edge)"
        strokeWidth={1.2}
      />
      <rect x={9} y={24} width={46} height={5} rx={2.5} fill="var(--kr-art-shell-hi)" />
      {/* puertos */}
      <g fill="var(--kr-art-screen)">
        {SWITCH_PORTS.map((x) => (
          <rect key={x} x={x} y={32} width={5} height={6} rx={1} />
        ))}
      </g>
      {/* LED de enlace en acento */}
      <circle cx={13.5} cy={30} r={1.3} fill="var(--kr-art-glow)" />
      <rect x={9} y={40} width={46} height={2.5} rx={1.2} fill="var(--kr-art-shell-lo)" opacity={0.9} />
    </ArtSvg>
  );
}
