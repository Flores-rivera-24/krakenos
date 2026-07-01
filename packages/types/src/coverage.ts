/**
 * Tipos de la cobertura WiFi (planos de la casa, predicción de señal por
 * propagación RF y survey de medición real). Compartidos entre el agente y el
 * frontend para que el modelo de datos, la API y la UI no diverjan.
 *
 * Sistema de coordenadas del plano: metros, origen arriba-izquierda, `x` hacia
 * la derecha e `y` hacia abajo (como un lienzo). Todas las posiciones (paredes,
 * APs, muestras) usan ese espacio.
 */
import type { Id, IsoDateTime } from './common.js';
import type { WifiBand } from './wifi.js';

/** Material de una pared/obstáculo; determina su atenuación de RF. */
export type WallMaterial = 'drywall' | 'wood' | 'glass' | 'brick' | 'concrete' | 'metal';

/** Todos los materiales disponibles, en orden de menor a mayor atenuación. */
export const WALL_MATERIALS: readonly WallMaterial[] = [
  'drywall',
  'wood',
  'glass',
  'brick',
  'concrete',
  'metal',
] as const;

/** Segmento de pared/obstáculo del plano (coordenadas en metros). */
export interface Wall {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  material: WallMaterial;
}

/** Punto de acceso colocado sobre el plano por el usuario. */
export interface ApPlacement {
  id: string;
  /** Id del `AccessPoint` real del driver, o `null` si es un AP manual/virtual. */
  apId: string | null;
  name: string;
  /** Posición en el plano (metros). */
  x: number;
  y: number;
  /** Potencia de transmisión efectiva (EIRP) en dBm. */
  txPowerDbm: number;
  /** Bandas que emite este AP. */
  bands: WifiBand[];
  enabled: boolean;
}

/** Plano guardado de una planta de la casa. */
export interface FloorPlan {
  id: Id;
  name: string;
  /** Ancho real del plano en metros. */
  widthM: number;
  /** Alto real del plano en metros. */
  heightM: number;
  /** Data URL (base64) de un plano de fondo opcional, o `null`. */
  backgroundImage: string | null;
  walls: Wall[];
  accessPoints: ApPlacement[];
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface CreateFloorPlanRequest {
  name: string;
  widthM: number;
  heightM: number;
  backgroundImage?: string | null;
  walls?: Wall[];
  accessPoints?: ApPlacement[];
}

export interface UpdateFloorPlanRequest {
  name?: string;
  widthM?: number;
  heightM?: number;
  backgroundImage?: string | null;
  walls?: Wall[];
  accessPoints?: ApPlacement[];
}

/** AP disponible para colocar, derivado en vivo del driver de hardware. */
export interface PlaceableAccessPoint {
  id: string;
  name: string;
  model: string | null;
  ip: string;
  online: boolean;
  /** Bandas que emite (agregadas de sus redes). */
  bands: WifiBand[];
}

/** Categoría de calidad de señal, para colorear y la leyenda. */
export type SignalQuality = 'excellent' | 'good' | 'fair' | 'weak' | 'none';

/** Umbrales de calidad (dBm). El límite inferior de cada categoría. */
export const SIGNAL_QUALITY_THRESHOLDS = {
  /** `>= -50` dBm. */
  excellent: -50,
  /** `>= -60` dBm. */
  good: -60,
  /** `>= -67` dBm. */
  fair: -67,
  /** `>= -75` dBm; por debajo es `none`. */
  weak: -75,
} as const;

/** Clasifica un RSSI (dBm) en una categoría de calidad. `null` → `none`. */
export function signalQuality(dbm: number | null): SignalQuality {
  if (dbm == null) return 'none';
  if (dbm >= SIGNAL_QUALITY_THRESHOLDS.excellent) return 'excellent';
  if (dbm >= SIGNAL_QUALITY_THRESHOLDS.good) return 'good';
  if (dbm >= SIGNAL_QUALITY_THRESHOLDS.fair) return 'fair';
  if (dbm >= SIGNAL_QUALITY_THRESHOLDS.weak) return 'weak';
  return 'none';
}

/**
 * Rejilla de cobertura calculada (predicha o medida). Los valores van en
 * orden row-major (`values[row * cols + col]`); cada celda es el RSSI estimado
 * en dBm en el centro de la celda, o `null` si no hay dato (predicha: por
 * debajo del suelo de sensibilidad; medida: fuera del radio de interpolación).
 */
export interface CoverageHeatmap {
  band: WifiBand;
  source: 'predicted' | 'measured';
  widthM: number;
  heightM: number;
  cols: number;
  rows: number;
  cellSizeM: number;
  values: (number | null)[];
  /** Cotas para la leyenda (dBm). */
  minDbm: number;
  maxDbm: number;
}

// ---- Survey (medición real) ----

/** Una muestra de señal medida en un punto del plano. */
export interface SurveySample {
  id: Id;
  scanId: Id;
  /** Posición en el plano (metros). */
  x: number;
  y: number;
  rssiDbm: number;
  createdAt: IsoDateTime;
}

/** Un recorrido de medición (survey) sobre un plano. */
export interface SurveyScan {
  id: Id;
  floorPlanId: Id;
  name: string;
  band: WifiBand;
  /** MAC del dispositivo itinerante cuya señal en vivo se registra, o `null` si manual. */
  deviceMac: string | null;
  createdAt: IsoDateTime;
}

/** Un survey con sus muestras cargadas. */
export interface SurveyScanDetail extends SurveyScan {
  samples: SurveySample[];
}

export interface CreateSurveyScanRequest {
  name: string;
  band: WifiBand;
  deviceMac?: string | null;
}

/**
 * Registrar una muestra. Si `rssiDbm` se omite, el servidor mide en vivo la
 * señal del `deviceMac` del survey a través del driver.
 */
export interface RecordSurveySampleRequest {
  x: number;
  y: number;
  rssiDbm?: number;
}

/** Resultado de un intento de medición en vivo. */
export interface MeasureResult {
  /** `true` si el dispositivo se encontró conectado en algún AP. */
  found: boolean;
  rssiDbm: number | null;
  sample: SurveySample | null;
}
