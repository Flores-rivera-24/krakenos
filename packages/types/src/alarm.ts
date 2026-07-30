import type { Id, IsoDateTime } from './common.js';

/**
 * Modo de alarma del hogar (US-188). `away` vigila todo (fuera de casa); `night`
 * vigila el perímetro pero no las zonas interiores (dormir en casa).
 */
export type AlarmMode = 'away' | 'night';
export const ALARM_MODES = ['away', 'night'] as const;

/**
 * Fase de la máquina de estados de la alarma (US-188):
 * - `disarmed`  — desactivada.
 * - `arming`    — armándose: cuenta atrás de **salida** (para salir sin disparar).
 * - `armed`     — armada y vigilando.
 * - `entry`     — un sensor disparó: cuenta atrás de **entrada** (para desarmar).
 * - `triggered` — alarma sonando (sirena/luces/aviso).
 */
export type AlarmPhase = 'disarmed' | 'arming' | 'armed' | 'entry' | 'triggered';

/** Estado observable de la alarma. */
/**
 * Estado de la **máquina de estados pura** (`alarm/state-machine.ts`): solo la
 * fase y sus datos. No incluye nada derivado de la configuración.
 */
export interface AlarmMachineState {
  phase: AlarmPhase;
  /** Modo cuando está armada/armándose; `null` si está desarmada. */
  mode: AlarmMode | null;
  /** Momento del último cambio de fase (para las cuentas atrás). */
  since: IsoDateTime;
  /** Fin de la cuenta atrás activa (salida/entrada), o `null`. */
  countdownEndsAt: IsoDateTime | null;
  /** Qué disparó `entry`/`triggered` (nombre legible), o `null`. */
  triggeredBy: string | null;
}

/** Estado que devuelve la API: la máquina más lo derivado de la config. */
export interface AlarmState extends AlarmMachineState {
  /**
   * ¿El desarme exige PIN? (US-235). **No expone el PIN**, solo si hay uno puesto.
   *
   * Sin esto, la UI descubría que hacía falta **fallando**: el primer «Desarmar»
   * iba sin PIN, el 401 revelaba el campo y el mensaje no llegaba a mostrarse. Con
   * la sirena sonando, eso son dos viajes y cero explicación.
   */
  requiresPin: boolean;
}

/**
 * Configuración de la alarma (US-188). Los dispositivos referenciados son ids de
 * IoT (sirena/luces/sensores) y de cámaras. `hasPin` indica si hay PIN puesto
 * (el PIN **nunca** se devuelve por la API).
 */
export interface AlarmConfig {
  /** Enchufe/dispositivo que hace de sirena (se enciende al disparar). */
  sirenDeviceId: Id | null;
  /** Luces que se encienden al disparar (disuasión). */
  lightDeviceIds: Id[];
  /** Sensores IoT (apertura/movimiento) vigilados. */
  sensorDeviceIds: Id[];
  /** Cámaras cuya detección de movimiento arma el disparo. */
  cameraIds: Id[];
  /** Segundos de gracia al armar (para salir). */
  exitDelaySec: number;
  /** Segundos de gracia tras un disparo (para desarmar antes de la sirena). */
  entryDelaySec: number;
  /** Armar en `away` automáticamente cuando el hogar pasa a modo `away` (US-169). */
  autoArmAway: boolean;
  /** ¿Hay PIN configurado? (el valor nunca se expone). */
  hasPin: boolean;
}

export interface ArmAlarmRequest {
  mode: AlarmMode;
}

export interface DisarmAlarmRequest {
  /** PIN de desarme (requerido si hay PIN puesto). */
  pin?: string;
}

/** Cambios de la config de alarma (`PUT /api/alarm/config`). `pin: null` lo quita. */
export interface UpdateAlarmConfigRequest {
  sirenDeviceId?: Id | null;
  lightDeviceIds?: Id[];
  sensorDeviceIds?: Id[];
  cameraIds?: Id[];
  exitDelaySec?: number;
  entryDelaySec?: number;
  autoArmAway?: boolean;
  /** Nuevo PIN (se guarda hasheado); `null` lo elimina; ausente no lo toca. */
  pin?: string | null;
}
