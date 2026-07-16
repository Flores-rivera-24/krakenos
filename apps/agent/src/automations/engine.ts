import type {
  AutomationCondition,
  AutomationRule,
  AutomationTrigger,
  HomeEvent,
} from '@krakenos/types';

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
    case 'motion-detected':
      return (
        event.type === 'motion-detected' &&
        (!trigger.cameraId || event.cameraId === trigger.cameraId) &&
        // Filtro por objeto detectado (Frigate, US-214): solo eventos nativos
        // llevan `label`; una regla con label NO dispara con frame-diff local.
        (!trigger.label || event.label === trigger.label)
      );
    case 'time':
      return false; // los disparadores de hora van por el barrido (dueTimeRules)
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

/** ¿Un disparador `time` cruza su instante programado en (prev, now]? */
export function timeTriggerDue(
  trigger: Extract<AutomationTrigger, { type: 'time' }>,
  prev: Date,
  now: Date,
): boolean {
  // El instante programado puede caer en la fecha de `prev` o en la de `now`
  // (el barrido puede cruzar medianoche); se prueban ambas.
  for (const base of [prev, now]) {
    const at = new Date(base);
    at.setHours(Math.floor(trigger.minute / 60), trigger.minute % 60, 0, 0);
    if (trigger.days.includes(at.getDay()) && at > prev && at <= now) return true;
  }
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

/** Reglas de hora que cruzan su instante en (prev, now]. */
export function dueTimeRules(
  rules: AutomationRule[],
  prev: Date,
  now: Date,
  lastFired: LastFiredMap,
): AutomationRule[] {
  return rules.filter(
    (rule) =>
      rule.enabled &&
      rule.trigger.type === 'time' &&
      timeTriggerDue(rule.trigger, prev, now) &&
      passesCondition(rule.condition, now) &&
      cooledDown(rule, lastFired, now),
  );
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
    // La presencia, el modo y el movimiento no aportan un dispositivo objetivo.
    case 'person-arrived':
    case 'person-left':
    case 'mode-changed':
    case 'motion-detected':
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
  }
}
