import type { Id, IsoDateTime } from './common.js';
import type { IotMetric } from './iot.js';
import type { HomeMode } from './presence.js';
import type { WeatherMetric } from './weather.js';

/**
 * Automatizaciones «si X entonces Y» (US-167). El motor es local (sin nube):
 * los disparadores se alimentan de los eventos que el agente ya produce
 * (inventario, estado IoT) más un barrido de hora por cruce de minuto.
 */

/** Disparador de una regla. */
export type AutomationTrigger =
  /** Un dispositivo con MAC nunca vista aparece en la red. */
  | { type: 'device-new' }
  /** Un dispositivo concreto pasa a online/offline en el inventario. */
  | { type: 'device-online'; mac: string }
  | { type: 'device-offline'; mac: string }
  /** Un dispositivo IoT concreto pasa a encendido/apagado. */
  | { type: 'iot-on'; deviceId: Id }
  | { type: 'iot-off'; deviceId: Id }
  /** La lectura de un sensor cruza un umbral (dispara solo al cruzar, no sostenido). */
  | { type: 'sensor-threshold'; deviceId: Id; op: 'gt' | 'lt'; value: number }
  /** Un dispositivo supera su umbral de consumo (US-183). Sin `deviceId` = cualquiera. */
  | { type: 'energy-threshold'; deviceId?: Id }
  /**
   * Una cámara detecta movimiento (US-186). Sin `cameraId` = cualquiera. Con
   * detección nativa (Frigate, US-214), `label` filtra por objeto detectado
   * (`person`/`car`/…); sin `label` = cualquier detección.
   */
  | { type: 'motion-detected'; cameraId?: Id; label?: string }
  /**
   * El tiempo exterior cruza un umbral (US-254). Dispara **al cruzar**, no
   * sostenido —igual que `sensor-threshold`—: con una lectura horaria, un
   * disparador sostenido ejecutaría la regla cada hora mientras durase el frío.
   *
   * Requiere el opt-in de `WeatherConfig`; sin él no llega ninguna lectura y
   * una regla con este disparador **nunca** dispara (la UI lo declara).
   */
  | { type: 'weather-threshold'; metric: WeatherMetric; op: 'gt' | 'lt'; value: number }
  /** Hora fija en días concretos (0-6, Dom-Sáb), por cruce de minuto. */
  | { type: 'time'; days: number[]; minute: number }
  /** Una persona llega/se va de casa (US-169). Sin `userId` = cualquiera. */
  | { type: 'person-arrived'; userId?: Id }
  | { type: 'person-left'; userId?: Id }
  /** El hogar entra en un modo concreto (US-169). */
  | { type: 'mode-changed'; mode: HomeMode };

/**
 * Condición opcional: la regla solo dispara dentro de la ventana. Si
 * `fromMinute > toMinute` la ventana cruza medianoche (p. ej. 22:00→07:00).
 */
export interface AutomationCondition {
  /** Días permitidos (0-6, Dom-Sáb). Ausente = todos. */
  days?: number[];
  fromMinute?: number;
  toMinute?: number;
}

/**
 * Acción de una regla. En `iot-set`/`device-block`/`device-pause`, omitir el
 * objetivo significa «el dispositivo del evento» (p. ej. "dispositivo
 * desconocido → bloquéalo"); una regla cuyo disparador no aporta objetivo
 * compatible falla esa acción de forma controlada.
 */
export type AutomationAction =
  | { type: 'iot-set'; deviceId?: Id; on?: boolean; brightness?: number }
  | { type: 'scene-run'; sceneId: Id }
  | { type: 'device-block'; mac?: string }
  /**
   * Quita el bloqueo **manual** de un dispositivo. Existe porque sin ella solo se
   * podía escribir media rutina: el motor sabía cortar y no sabía devolver, así que
   * «bloquéalo cuando salga de casa» dejaba el aparato cortado para siempre salvo
   * que alguien entrase a mano.
   *
   * ⚠️ No fuerza el acceso: si un **horario** o una **pausa** siguen activos, el
   * dispositivo sigue bloqueado — el bloqueo efectivo son tres fuentes en OR
   * (`access/blocked-eval.ts`) y esta acción solo suelta la suya.
   */
  | { type: 'device-unblock'; mac?: string }
  | { type: 'device-pause'; mac?: string; minutes: number }
  | { type: 'notify'; message: string };

export interface AutomationRule {
  id: Id;
  name: string;
  enabled: boolean;
  trigger: AutomationTrigger;
  condition?: AutomationCondition;
  actions: AutomationAction[];
  /** Segundos mínimos entre disparos de la misma regla (anti-ruido/anti-bucle). */
  cooldownSec: number;
  createdAt: IsoDateTime;
}

/** Alta de regla (`POST /api/automations`). */
export interface CreateAutomationRuleRequest {
  name: string;
  enabled?: boolean;
  trigger: AutomationTrigger;
  condition?: AutomationCondition;
  actions: AutomationAction[];
  cooldownSec?: number;
}

/** Cambios parciales (`PATCH /api/automations/:id`). `condition: null` la quita. */
export interface UpdateAutomationRuleRequest {
  name?: string;
  enabled?: boolean;
  trigger?: AutomationTrigger;
  condition?: AutomationCondition | null;
  actions?: AutomationAction[];
  cooldownSec?: number;
}

/** Ejecución registrada de una regla (log, `GET /api/automations/runs`). */
export interface AutomationRun {
  id: Id;
  ruleId: Id;
  /** Resumen legible del evento que disparó la regla. */
  event: string;
  ok: boolean;
  /** Detalle de fallos por acción (si los hubo). */
  detail: string | null;
  createdAt: IsoDateTime;
}

/**
 * Evento interno del hogar (bus ligero del agente, US-167). `origin` marca la
 * procedencia para el anti-bucle: un evento causado por una automatización
 * lleva `automation:<ruleId>` y esa misma regla no se re-dispara con él.
 */
export type HomeEvent = (
  | { type: 'device-new'; mac: string }
  | { type: 'device-online'; mac: string }
  | { type: 'device-offline'; mac: string }
  | { type: 'iot-on'; deviceId: Id }
  | { type: 'iot-off'; deviceId: Id }
  /**
   * Una lectura de un dispositivo cambió. `metric` (US-244) es lo que permite a
   * un consumidor saber **qué** cambió: sin él, «una puerta se ha abierto» y
   * «este enchufe consume 5 W» eran el mismo evento con distinto número, y la
   * alarma —que solo podía mirar el número— se disparaba con una lámpara.
   */
  | {
      type: 'sensor-reading';
      deviceId: Id;
      metric: IotMetric;
      value: number;
      prevValue: number | null;
    }
  /**
   * Un dispositivo cruza su umbral de consumo (US-183). `metric` distingue
   * potencia sostenida (W) de energía diaria (Wh); `value` es la magnitud
   * observada y `threshold` el umbral configurado. Lo emite `EnergyAlertService`.
   */
  | {
      type: 'energy-threshold';
      deviceId: Id;
      metric: 'sustained-power' | 'daily-energy';
      value: number;
      threshold: number;
    }
  /**
   * Una cámara detecta movimiento (US-186). `cameraName` acompaña al id para que
   * el log de ejecuciones sea legible sin otra consulta.
   */
  | { type: 'motion-detected'; cameraId: Id; cameraName: string; label?: string }
  /**
   * Lectura del tiempo exterior (US-254). Lleva `prevValue` —como
   * `sensor-reading`— porque el flanco lo calcula el motor: es él quien sabe qué
   * umbral pide cada regla, y guardarlo por regla en el servicio duplicaría ese
   * estado en dos sitios.
   */
  | {
      type: 'weather-reading';
      metric: WeatherMetric;
      value: number;
      prevValue: number | null;
    }
  /**
   * Presencia y modos del hogar (US-169). `name` acompaña al id para que el log
   * de ejecuciones sea legible sin otra consulta.
   */
  | { type: 'person-arrived'; userId: Id; name: string }
  | { type: 'person-left'; userId: Id; name: string }
  | { type: 'mode-changed'; mode: HomeMode; prevMode: HomeMode }
) & { origin?: string };
