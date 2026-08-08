import type {
  AutomationCondition,
  AutomationRule,
  AutomationTrigger,
  HomeEvent,
  WeatherMetric,
} from '@krakenos/types';
import { WEATHER_UNITS } from '@krakenos/types';
import { sunEventLocalMinutes } from '../iot/solar.js';

/** Ubicación del hogar para el cálculo solar (grados), o `null` si no está configurada. */
export interface HomeLocation {
  lat: number;
  lon: number;
}

/** Nombre de cada magnitud en el log de ejecuciones (español, como el resto). */
const DESCRIPCION_METRICA: Record<WeatherMetric, string> = {
  temperature: 'temperatura',
  precipitation: 'lluvia',
  wind: 'viento',
};

/**
 * Motor de automatizaciones (US-167) — **puro y testeable**: decide qué reglas
 * deben disparar ante un evento del hogar o ante el paso del tiempo, aplicando
 * condición, cooldown y anti-bucle. No ejecuta acciones ni toca I/O; eso vive en
 * `AutomationService`.
 */

/** ¿El evento satisface el disparador? (sin condición ni cooldown). */
export function matchesTrigger(trigger: AutomationTrigger, event: HomeEvent): boolean {
  switch (trigger.type) {
    case 'device-new':
      return event.type === 'device-new';
    case 'device-online':
      return event.type === 'device-online' && event.mac === trigger.mac;
    case 'device-offline':
      return event.type === 'device-offline' && event.mac === trigger.mac;
    case 'iot-on':
      return event.type === 'iot-on' && event.deviceId === trigger.deviceId;
    case 'iot-off':
      return event.type === 'iot-off' && event.deviceId === trigger.deviceId;
    case 'sensor-threshold': {
      if (event.type !== 'sensor-reading' || event.deviceId !== trigger.deviceId) return false;
      // Dispara solo al CRUZAR el umbral (no sostenido): la lectura actual lo
      // satisface y la anterior no (o no había anterior).
      const satisfies = (v: number) => (trigger.op === 'gt' ? v > trigger.value : v < trigger.value);
      return satisfies(event.value) && (event.prevValue === null || !satisfies(event.prevValue));
    }
    case 'energy-threshold':
      return (
        event.type === 'energy-threshold' &&
        (!trigger.deviceId || event.deviceId === trigger.deviceId)
      );
    case 'weather-threshold': {
      if (event.type !== 'weather-reading' || event.metric !== trigger.metric) return false;
      // Mismo flanco que `sensor-threshold`: cruzar, no sostener. Con lectura
      // horaria, «sostenido» sería disparar cada hora mientras siga helando.
      const satisfies = (v: number) => (trigger.op === 'gt' ? v > trigger.value : v < trigger.value);
      return satisfies(event.value) && (event.prevValue === null || !satisfies(event.prevValue));
    }
    case 'motion-detected':
      return (
        event.type === 'motion-detected' &&
        (!trigger.cameraId || event.cameraId === trigger.cameraId) &&
        // Filtro por objeto detectado (Frigate, US-214): solo eventos nativos
        // llevan `label`; una regla con label NO dispara con frame-diff local.
        (!trigger.label || event.label === trigger.label)
      );
    // Los disparadores de calendario no los produce ningún evento del bus: van
    // por el barrido (`dueScheduledRules`), que es quien conoce la ventana
    // (prev, now] y la ubicación del hogar.
    case 'time':
    case 'sun':
      return false;
    case 'person-arrived':
      return (
        event.type === 'person-arrived' && (!trigger.userId || event.userId === trigger.userId)
      );
    case 'person-left':
      return event.type === 'person-left' && (!trigger.userId || event.userId === trigger.userId);
    case 'mode-changed':
      return event.type === 'mode-changed' && event.mode === trigger.mode;
  }
}

/** ¿La condición (ventana de días/horas) permite disparar en `now`? */
export function passesCondition(condition: AutomationCondition | undefined, now: Date): boolean {
  if (!condition) return true;
  if (condition.days && !condition.days.includes(now.getDay())) return false;
  const from = condition.fromMinute;
  const to = condition.toMinute;
  if (from === undefined || to === undefined) return true;
  const minute = now.getHours() * 60 + now.getMinutes();
  // Ventana [from, to); si from > to cruza medianoche (p. ej. 22:00→07:00).
  return from <= to ? minute >= from && minute < to : minute >= from || minute < to;
}

/** Minuto del día acotado a [0,1439]: un desfase solar no puede saltar de día. */
function clampMinute(minute: number): number {
  return Math.min(1439, Math.max(0, minute));
}

/** Instante local del minuto `minute` en la fecha de `base`. */
function atMinuteOf(base: Date, minute: number): Date {
  const at = new Date(base);
  at.setHours(Math.floor(minute / 60), minute % 60, 0, 0);
  return at;
}

/** ¿Un disparador `time` cruza su instante programado en (prev, now]? */
export function timeTriggerDue(
  trigger: Extract<AutomationTrigger, { type: 'time' }>,
  prev: Date,
  now: Date,
): boolean {
  // El instante programado puede caer en la fecha de `prev` o en la de `now`
  // (el barrido puede cruzar medianoche); se prueban ambas.
  for (const base of [prev, now]) {
    const at = atMinuteOf(base, trigger.minute);
    if (trigger.days.includes(at.getDay()) && at > prev && at <= now) return true;
  }
  return false;
}

/**
 * ¿Un disparador `sun` cruza su instante en (prev, now]? El minuto solar se
 * recalcula **para cada fecha candidata**, no una vez para «hoy»: amanecer y
 * atardecer se mueven cada día, y evaluar el borde de medianoche con la fecha
 * equivocada adelanta o atrasa el disparo sin que nada falle.
 *
 * Sin ubicación del hogar devuelve `false` siempre: es la negación honesta de
 * una regla que no se puede evaluar, no un fallo. Igual en un día polar, donde
 * `sunEventLocalMinutes` devuelve `null` porque ese día no hay evento.
 */
export function sunTriggerDue(
  trigger: Extract<AutomationTrigger, { type: 'sun' }>,
  prev: Date,
  now: Date,
  home: HomeLocation | null,
): boolean {
  if (!home) return false;
  for (const base of [prev, now]) {
    const solar = sunEventLocalMinutes(base, home.lat, home.lon, trigger.event);
    if (solar === null) continue;
    const at = atMinuteOf(base, clampMinute(solar + trigger.offsetMin));
    if (trigger.days.includes(at.getDay()) && at > prev && at <= now) return true;
  }
  return false;
}

/**
 * ¿Este disparador de **calendario** (hora fija o sol) cruza su instante en
 * (prev, now]? Punto único: un tercer disparador de calendario se añade aquí y
 * lo hereda el barrido, en vez de repartirse por el servicio.
 */
function scheduledTriggerDue(
  trigger: AutomationTrigger,
  prev: Date,
  now: Date,
  home: HomeLocation | null,
): boolean {
  if (trigger.type === 'time') return timeTriggerDue(trigger, prev, now);
  if (trigger.type === 'sun') return sunTriggerDue(trigger, prev, now, home);
  return false;
}

/** Estado de cooldown: instante (ms epoch) del último disparo por regla. */
export type LastFiredMap = ReadonlyMap<string, number>;

function cooledDown(rule: AutomationRule, lastFired: LastFiredMap, now: Date): boolean {
  const last = lastFired.get(rule.id);
  return last === undefined || now.getTime() - last >= rule.cooldownSec * 1000;
}

/** Reglas que deben disparar ante `event` en el instante `now`. */
export function dueRulesForEvent(
  rules: AutomationRule[],
  event: HomeEvent,
  now: Date,
  lastFired: LastFiredMap,
): AutomationRule[] {
  return rules.filter(
    (rule) =>
      rule.enabled &&
      // Anti-bucle: un evento causado por esta misma regla no la re-dispara.
      event.origin !== `automation:${rule.id}` &&
      matchesTrigger(rule.trigger, event) &&
      passesCondition(rule.condition, now) &&
      cooledDown(rule, lastFired, now),
  );
}

/** Reglas de calendario (hora fija o sol) que cruzan su instante en (prev, now]. */
export function dueScheduledRules(
  rules: AutomationRule[],
  prev: Date,
  now: Date,
  lastFired: LastFiredMap,
  home: HomeLocation | null,
): AutomationRule[] {
  return rules.filter(
    (rule) =>
      rule.enabled &&
      scheduledTriggerDue(rule.trigger, prev, now, home) &&
      passesCondition(rule.condition, now) &&
      cooledDown(rule, lastFired, now),
  );
}

/**
 * Resumen del disparo de una regla de calendario para el log de ejecuciones.
 * «hora programada» sería mentira a medias en una regla solar: el usuario no
 * programó una hora, programó un suceso que cae a una hora distinta cada día.
 */
export function describeSchedule(rule: AutomationRule): string {
  if (rule.trigger.type === 'sun') {
    return rule.trigger.event === 'sunrise' ? 'amanecer' : 'atardecer';
  }
  return 'hora programada';
}

/** Objetivo implícito del evento, para acciones sin objetivo explícito. */
export function eventSubject(event: HomeEvent): { mac?: string; deviceId?: string } {
  switch (event.type) {
    case 'device-new':
    case 'device-online':
    case 'device-offline':
      return { mac: event.mac };
    case 'iot-on':
    case 'iot-off':
    case 'sensor-reading':
    case 'energy-threshold':
      return { deviceId: event.deviceId };
    // La presencia, el modo, el movimiento y el tiempo no aportan un dispositivo
    // objetivo: una regla del tiempo debe nombrar a quién apaga o enciende.
    case 'person-arrived':
    case 'person-left':
    case 'mode-changed':
    case 'motion-detected':
    case 'weather-reading':
      return {};
  }
}

/** Resumen legible de un evento para el log de ejecuciones. */
export function describeEvent(event: HomeEvent): string {
  switch (event.type) {
    case 'device-new':
      return `dispositivo desconocido ${event.mac}`;
    case 'device-online':
      return `${event.mac} en línea`;
    case 'device-offline':
      return `${event.mac} desconectado`;
    case 'iot-on':
      return `${event.deviceId} encendido`;
    case 'iot-off':
      return `${event.deviceId} apagado`;
    case 'sensor-reading':
      return `${event.deviceId} = ${event.value}`;
    case 'energy-threshold':
      return event.metric === 'sustained-power'
        ? `${event.deviceId} supera ${event.threshold} W`
        : `${event.deviceId} supera ${event.threshold} Wh hoy`;
    // Sin el nombre a propósito: el log de ejecuciones (`AutomationRun.event`)
    // lo lee cualquier usuario autenticado, y la presencia ajena es privada por
    // rol (US-169) — el nombre del evento del bus no debe acabar persistido ahí.
    case 'person-arrived':
      return 'alguien llega a casa';
    case 'person-left':
      return 'alguien sale de casa';
    case 'mode-changed':
      return `modo del hogar → ${event.mode}`;
    // El nombre de la cámara lo pone el admin (no es PII como la presencia ajena);
    // el label lo pone el detector del NVR (person/car/…), tampoco lo es.
    case 'motion-detected':
      return event.label
        ? `${event.label} en ${event.cameraName}`
        : `movimiento en ${event.cameraName}`;
    // Magnitud y valor, nunca la ubicación: `AutomationRun.event` lo lee cualquier
    // autenticado y las coordenadas del hogar solo las ve un admin (AUD3-02).
    case 'weather-reading':
      return `tiempo exterior: ${DESCRIPCION_METRICA[event.metric]} ${event.value} ${WEATHER_UNITS[event.metric]}`;
  }
}
