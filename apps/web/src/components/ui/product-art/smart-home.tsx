import { ArtSvg, type ArtProps } from './shared';

/** Bombilla inteligente — globo de cristal con luz cálida y casquillo. */
export function BulbArt({ className, title }: ArtProps) {
  return (
    <ArtSvg className={className} title={title}>
      {/* halo de acento */}
      <circle cx={32} cy={26} r={18} fill="var(--kr-art-glow)" opacity={0.14} />
      {/* globo de cristal */}
      <circle
        cx={32}
        cy={25}
        r={14}
        fill="var(--kr-art-glass)"
        stroke="var(--kr-art-edge)"
        strokeWidth={1}
      />
      {/* luz cálida interior */}
      <circle cx={32} cy={25} r={8} fill="var(--kr-art-warm)" opacity={0.85} />
      {/* filamento */}
      <path
        d="M28 27 L30 22 L32 27 L34 22 L36 27"
        stroke="var(--kr-art-metal-lo)"
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* cuello */}
      <path d="M25 36 L39 36 L37 41 L27 41 Z" fill="var(--kr-art-metal-lo)" />
      {/* casquillo roscado */}
      <rect x={27} y={41} width={10} height={8} rx={1.5} fill="var(--kr-art-metal)" />
      <path d="M27 44 H37 M27 46.5 H37" stroke="var(--kr-art-metal-lo)" strokeWidth={1} />
    </ArtSvg>
  );
}

/** Enchufe inteligente — cara con botón de encendido y clavijas. */
export function PlugArt({ className, title }: ArtProps) {
  return (
    <ArtSvg className={className} title={title}>
      <rect
        x={16}
        y={11}
        width={32}
        height={40}
        rx={9}
        fill="var(--kr-art-shell)"
        stroke="var(--kr-art-edge)"
        strokeWidth={1.2}
      />
      <rect x={19} y={14} width={26} height={10} rx={5} fill="var(--kr-art-shell-hi)" opacity={0.55} />
      {/* anillo/botón de encendido */}
      <circle cx={32} cy={31} r={9} fill="var(--kr-art-shell-lo)" />
      <circle cx={32} cy={31} r={8} fill="none" stroke="var(--kr-art-glow)" strokeWidth={2} />
      <path d="M32 25.5 V31" stroke="var(--kr-art-glow)" strokeWidth={2} strokeLinecap="round" />
      {/* clavijas */}
      <g stroke="var(--kr-art-metal)" strokeWidth={2.6} strokeLinecap="round">
        <path d="M27 51 V56" />
        <path d="M37 51 V56" />
      </g>
    </ArtSvg>
  );
}

/** Cámara IP — cuerpo, lente con anillo de acento, LED y soporte. */
export function CameraArt({ className, title }: ArtProps) {
  return (
    <ArtSvg className={className} title={title}>
      <rect
        x={10}
        y={18}
        width={44}
        height={28}
        rx={8}
        fill="var(--kr-art-shell)"
        stroke="var(--kr-art-edge)"
        strokeWidth={1.2}
      />
      <rect x={13} y={21} width={30} height={7} rx={3.5} fill="var(--kr-art-shell-hi)" opacity={0.55} />
      {/* lente */}
      <circle cx={32} cy={32} r={10} fill="var(--kr-art-screen)" stroke="var(--kr-art-edge)" strokeWidth={1} />
      <circle cx={32} cy={32} r={9} fill="none" stroke="var(--kr-art-glow)" strokeWidth={1.6} />
      <circle cx={32} cy={32} r={5.5} fill="var(--kr-art-shell-lo)" />
      <circle cx={29} cy={29} r={2} fill="var(--kr-art-metal)" opacity={0.8} />
      {/* LED de estado */}
      <circle cx={47} cy={23} r={1.6} fill="var(--kr-art-glow)" />
      {/* soporte */}
      <rect x={28} y={46} width={8} height={5} rx={1.5} fill="var(--kr-art-metal-lo)" />
      <rect x={25} y={50} width={14} height={3} rx={1.5} fill="var(--kr-art-metal)" />
    </ArtSvg>
  );
}

/** Sensor IoT — puck con lente y ondas de detección. */
export function SensorArt({ className, title }: ArtProps) {
  return (
    <ArtSvg className={className} title={title}>
      {/* ondas de detección */}
      <g stroke="var(--kr-art-glow)" strokeWidth={1.8} fill="none" strokeLinecap="round">
        <path d="M23 18 A13 13 0 0 1 41 18" opacity={0.9} />
        <path d="M27 22 A8 8 0 0 1 37 22" opacity={0.55} />
      </g>
      {/* puck */}
      <rect
        x={20}
        y={27}
        width={24}
        height={25}
        rx={6}
        fill="var(--kr-art-shell)"
        stroke="var(--kr-art-edge)"
        strokeWidth={1.2}
      />
      <rect x={23} y={30} width={18} height={5} rx={2.5} fill="var(--kr-art-shell-hi)" opacity={0.55} />
      {/* lente del sensor */}
      <circle cx={32} cy={42} r={5} fill="var(--kr-art-screen)" stroke="var(--kr-art-edge)" strokeWidth={1} />
      <circle cx={32} cy={42} r={2} fill="var(--kr-art-glow)" />
    </ArtSvg>
  );
}
