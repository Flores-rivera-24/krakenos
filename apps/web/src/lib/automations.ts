import type {
  AutomationAction,
  AutomationCondition,
  AutomationRule,
  AutomationRun,
  AutomationTrigger,
  CreateAutomationRuleRequest,
  IotDevice,
  Scene,
  UpdateAutomationRuleRequest,
  WeatherMetric,
} from '@krakenos/types';
import { WEATHER_UNITS } from '@krakenos/types';
import { api } from '@/lib/api';

import { t as tPorDefecto, type TranslationKey } from '@/lib/i18n';
import { MODE_LABEL_KEYS } from '@/lib/presence';
import {
  diasCortos,
  formatSunOffset,
  minuteToTimeString,
  type Traducir,
} from '@/lib/schedule-format';

/**
 * Clave de copy de cada magnitud del tiempo (US-254). «la temperatura baja de
 * 5 °C» se lee como una frase; «temperature lt 5» no.
 */
export const WEATHER_METRIC_KEYS: Record<WeatherMetric, TranslationKey> = {
  temperature: 'automation.weatherMetric.temperature',
  precipitation: 'automation.weatherMetric.precipitation',
  wind: 'automation.weatherMetric.wind',
};

export const listAutomations = () => api.getList<AutomationRule>('/automations');
export const createAutomation = (body: CreateAutomationRuleRequest) =>
  api.post<AutomationRule>('/automations', body);
export const updateAutomation = (id: string, body: UpdateAutomationRuleRequest) =>
  api.patch<AutomationRule>(`/automations/${id}`, body);
export const deleteAutomation = (id: string) => api.del<void>(`/automations/${id}`);
export const listAutomationRuns = (ruleId?: string) =>
  api.getList<AutomationRun>(`/automations/runs${ruleId ? `?ruleId=${encodeURIComponent(ruleId)}` : ''}`);

/** Contexto para resolver ids a nombres humanos en las frases. */
export interface NameContext {
  devices?: IotDevice[];
  scenes?: Scene[];
  /** MAC → etiqueta amable de red (label/hostname). */
  networkNames?: Map<string, string>;
  /** userId → nombre de la persona (para los disparadores de presencia, US-169). */
  userNames?: Map<string, string>;
  /** cameraId → nombre de la cámara (disparador de movimiento, US-186). */
  cameraNames?: Map<string, string>;
}

const iotName = (ctx: NameContext, id: string) =>
  ctx.devices?.find((d) => d.id === id)?.name ?? id;
const macName = (ctx: NameContext, mac: string) => ctx.networkNames?.get(mac) ?? mac;

/**
 * Frase legible del disparador («Cuando…»), traducida (US-270).
 *
 * Cada caso resuelve **una plantilla completa** del catálogo, no trozos pegados:
 * una frase montada por concatenación no se traduce, se reordena, y en otro
 * idioma el sujeto, el verbo y el complemento no caen en el mismo sitio. Por eso
 * «supera» y «baja de» son dos claves y no una palabra intercambiable dentro de
 * una misma frase.
 *
 * `t` se inyecta en vez de llamarse dentro: así la función sigue siendo pura y
 * testeable, que es como estaba escrita.
 */
export function describeTrigger(
  trigger: AutomationTrigger,
  ctx: NameContext = {},
  t: Traducir = tPorDefecto,
): string {
  const dias = (days: number[]) =>
    days.map((d) => diasCortos(t)[d] ?? '?').join(' ');

  switch (trigger.type) {
    case 'device-new':
      return t('automation.trigger.deviceNew');
    case 'device-online':
      return t('automation.trigger.deviceOnline', { name: macName(ctx, trigger.mac) });
    case 'device-offline':
      return t('automation.trigger.deviceOffline', { name: macName(ctx, trigger.mac) });
    case 'iot-on':
      return t('automation.trigger.iotOn', { name: iotName(ctx, trigger.deviceId) });
    case 'iot-off':
      return t('automation.trigger.iotOff', { name: iotName(ctx, trigger.deviceId) });
    case 'sensor-threshold':
      return t(
        trigger.op === 'gt' ? 'automation.trigger.sensorAbove' : 'automation.trigger.sensorBelow',
        { name: iotName(ctx, trigger.deviceId), value: trigger.value },
      );
    case 'energy-threshold':
      return t('automation.trigger.energyThreshold', {
        name: trigger.deviceId ? iotName(ctx, trigger.deviceId) : t('automation.someDevice'),
      });
    case 'weather-threshold':
      return t(
        trigger.op === 'gt' ? 'automation.trigger.weatherAbove' : 'automation.trigger.weatherBelow',
        {
          metric: t(WEATHER_METRIC_KEYS[trigger.metric]),
          value: trigger.value,
          unit: WEATHER_UNITS[trigger.metric],
        },
      );
    case 'time':
      return t('automation.trigger.time', {
        time: minuteToTimeString(trigger.minute),
        days: dias(trigger.days),
      });
    // Se nombra el suceso, no una hora: el atardecer cae a una hora distinta cada
    // día y escribir «a las 21:14» sería cierto hoy y falso mañana.
    case 'sun':
      return t('automation.trigger.sun', {
        event: formatSunOffset(trigger.event, trigger.offsetMin, t).toLowerCase(),
        days: dias(trigger.days),
      });
    case 'person-arrived':
      return t('automation.trigger.personArrived', {
        name: trigger.userId
          ? (ctx.userNames?.get(trigger.userId) ?? trigger.userId)
          : t('automation.someone'),
      });
    case 'person-left':
      return t('automation.trigger.personLeft', {
        name: trigger.userId
          ? (ctx.userNames?.get(trigger.userId) ?? trigger.userId)
          : t('automation.someone'),
      });
    case 'mode-changed':
      return t('automation.trigger.modeChanged', { mode: t(MODE_LABEL_KEYS[trigger.mode]) });
    case 'motion-detected': {
      const camera = trigger.cameraId
        ? (ctx.cameraNames?.get(trigger.cameraId) ?? trigger.cameraId)
        : t('automation.someCamera');
      // Con detección nativa (Frigate, US-214) la regla puede filtrar por objeto.
      const clave = trigger.label ? MOTION_LABEL_KEYS[trigger.label] : undefined;
      const what = trigger.label
        ? (clave ? t(clave) : t('automation.quoted', { text: trigger.label }))
        : t('automation.motion');
      return t('automation.trigger.motionDetected', { camera, what });
    }
  }
}

/**
 * Clave de copy de los objetos que detecta el NVR (su vocabulario es inglés).
 * Uno desconocido se muestra citado tal cual: inventarle traducción a una
 * etiqueta que pone el detector sería adivinar.
 */
export const MOTION_LABEL_KEYS: Record<string, TranslationKey> = {
  person: 'automation.motionLabel.person',
  car: 'automation.motionLabel.car',
  dog: 'automation.motionLabel.dog',
  cat: 'automation.motionLabel.cat',
  package: 'automation.motionLabel.package',
};

/** Frase legible de una acción («entonces…»), traducida (US-270). */
export function describeAction(
  action: AutomationAction,
  ctx: NameContext = {},
  t: Traducir = tPorDefecto,
): string {
  switch (action.type) {
    case 'iot-set': {
      const target = action.deviceId ? iotName(ctx, action.deviceId) : t('automation.eventDevice');
      // El brillo NO se pega detrás de la frase: son plantillas distintas, porque
      // en otro idioma «al 40 %» puede no ir al final.
      if (action.brightness !== undefined) {
        return t(
          action.on === false ? 'automation.action.iotOffDim' : 'automation.action.iotOnDim',
          { target, brightness: action.brightness },
        );
      }
      return t(action.on === false ? 'automation.action.iotOff' : 'automation.action.iotOn', {
        target,
      });
    }
    case 'scene-run':
      return t('automation.action.sceneRun', {
        name: ctx.scenes?.find((s) => s.id === action.sceneId)?.name ?? action.sceneId,
      });
    case 'device-block':
      return t('automation.action.deviceBlock', {
        target: action.mac ? macName(ctx, action.mac) : t('automation.eventDevice'),
      });
    // «quita el bloqueo de» y no «desbloquea» a propósito: la acción suelta la
    // fuente manual, no garantiza acceso. Un horario o una pausa activos siguen
    // cortando, y el verbo tiene que prometer solo lo que hace.
    case 'device-unblock':
      // Dos plantillas y no una con la preposición pegada: en español «de» + «el
      // dispositivo…» daría «de el», y esa contracción es un problema del idioma,
      // no del dato — así que la resuelve el catálogo, cada uno en el suyo.
      return action.mac
        ? t('automation.action.deviceUnblock', { target: macName(ctx, action.mac) })
        : t('automation.action.deviceUnblockEvent');
    case 'device-pause':
      return t('automation.action.devicePause', {
        target: action.mac ? macName(ctx, action.mac) : t('automation.eventDevice'),
        minutes: action.minutes,
      });
    case 'notify':
      return t('automation.action.notify', { message: action.message });
  }
}

/** Frase legible de la condición («solo…»), o `null` si no hay. */
export function describeCondition(
  condition: AutomationCondition | undefined,
  t: Traducir = tPorDefecto,
): string | null {
  if (!condition) return null;
  // Las partes son DATOS (una lista de días, un rango horario), no trozos de
  // frase: unirlas con un separador se traduce igual en cualquier idioma. Lo que
  // sí es frase —el «solo …»— es una plantilla completa.
  const parts: string[] = [];
  if (condition.days && condition.days.length < 7) {
    parts.push(condition.days.map((d) => diasCortos(t)[d] ?? '?').join(' '));
  }
  if (condition.fromMinute !== undefined && condition.toMinute !== undefined) {
    parts.push(
      `${minuteToTimeString(condition.fromMinute)}–${minuteToTimeString(condition.toMinute)}`,
    );
  }
  return parts.length > 0 ? t('automation.condition.only', { parts: parts.join(' · ') }) : null;
}
