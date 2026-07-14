import type { Id, IsoDateTime } from './common.js';

/**
 * Modos del hogar + presencia por WiFi (US-169). La presencia se deriva de la
 * señal que el agente ya tiene: las transiciones online/offline de los
 * dispositivos personales (`Device.ownerId`, US-179) publicadas en el bus del
 * hogar (US-167). Sin geofence ni nube.
 */

/** Modos del hogar. Array `as const` como fuente única (los schemas derivan). */
export const HOME_MODES = ['home', 'away', 'night'] as const;
export type HomeMode = (typeof HOME_MODES)[number];

/** Quién fijó el modo actual: una persona (manual) o la derivación por presencia. */
export type HomeModeSource = 'manual' | 'presence';

/** Presencia de una persona del hogar (usuario con ≥1 dispositivo propio). */
export interface PersonPresence {
  userId: Id;
  displayName: string;
  /** ¿Está en casa? (≥1 dispositivo suyo online, con ventana de gracia al salir). */
  home: boolean;
  /** Instante de su última llegada/salida registrada, o `null` si nunca. */
  since: IsoDateTime | null;
  /** Nº de dispositivos personales que alimentan su presencia. */
  deviceCount: number;
  /**
   * Confianza de la señal (US-220): `fresh` = el dispositivo responde ahora;
   * `stale` = se le mantiene "en casa" pero su WiFi dejó de responder (salida
   * pendiente de confirmar por histéresis/gracia). Solo va por la API acotada por
   * rol, **nunca** por el socket broadcast (regla de privacidad US-169).
   */
  signal: 'fresh' | 'stale';
}

/**
 * Estado observable del hogar (`GET /api/presence`). `people` viene **acotado
 * por rol**: admin ve a todas las personas; el resto solo se ve a sí mismo
 * (la presencia ajena es dato sensible).
 */
export interface PresenceState {
  mode: HomeMode;
  modeSource: HomeModeSource;
  /** Instante del último cambio de modo, o `null` si nunca cambió. */
  modeChangedAt: IsoDateTime | null;
  people: PersonPresence[];
}

/** Llegada/salida registrada (timeline; misma privacidad por rol que `people`). */
export interface PresenceEvent {
  id: Id;
  userId: Id;
  displayName: string;
  kind: 'arrived' | 'left';
  at: IsoDateTime;
}

/** Cuerpo de `POST /api/presence/mode` (capacidad `home.control`). */
export interface SetHomeModeRequest {
  mode: HomeMode;
}
