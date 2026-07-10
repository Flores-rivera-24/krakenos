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
} from '@krakenos/types';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';
import { dayLabel, minuteToTimeString } from '@/lib/iot-schedules';
import { MODE_LABEL_KEYS } from '@/lib/presence';

export const listAutomations = () => api.get<AutomationRule[]>('/automations');
export const createAutomation = (body: CreateAutomationRuleRequest) =>
  api.post<AutomationRule>('/automations', body);
export const updateAutomation = (id: string, body: UpdateAutomationRuleRequest) =>
  api.patch<AutomationRule>(`/automations/${id}`, body);
export const deleteAutomation = (id: string) => api.del<void>(`/automations/${id}`);
export const listAutomationRuns = (ruleId?: string) =>
  api.get<AutomationRun[]>(`/automations/runs${ruleId ? `?ruleId=${encodeURIComponent(ruleId)}` : ''}`);

/** Contexto para resolver ids a nombres humanos en las frases. */
export interface NameContext {
  devices?: IotDevice[];
  scenes?: Scene[];
  /** MAC → etiqueta amable de red (label/hostname). */
  networkNames?: Map<string, string>;
  /** userId → nombre de la persona (para los disparadores de presencia, US-169). */
  userNames?: Map<string, string>;
}

const iotName = (ctx: NameContext, id: string) =>
  ctx.devices?.find((d) => d.id === id)?.name ?? id;
const macName = (ctx: NameContext, mac: string) => ctx.networkNames?.get(mac) ?? mac;

/** Nombre de la persona de un disparador de presencia, o «alguien» si es cualquiera. */
const personName = (ctx: NameContext, userId?: string): string =>
  userId ? (ctx.userNames?.get(userId) ?? userId) : t('automations.desc.someone');

/** Frase legible del disparador ("Cuando…"). Interpola frases completas por idioma. */
export function describeTrigger(trigger: AutomationTrigger, ctx: NameContext = {}): string {
  switch (trigger.type) {
    case 'device-new':
      return t('automations.desc.deviceNew');
    case 'device-online':
      return t('automations.desc.deviceOnline', { name: macName(ctx, trigger.mac) });
    case 'device-offline':
      return t('automations.desc.deviceOffline', { name: macName(ctx, trigger.mac) });
    case 'iot-on':
      return t('automations.desc.iotOn', { name: iotName(ctx, trigger.deviceId) });
    case 'iot-off':
      return t('automations.desc.iotOff', { name: iotName(ctx, trigger.deviceId) });
    case 'sensor-threshold':
      return t(
        trigger.op === 'gt' ? 'automations.desc.sensorAbove' : 'automations.desc.sensorBelow',
        { name: iotName(ctx, trigger.deviceId), value: trigger.value },
      );
    case 'time':
      return t('automations.desc.time', {
        time: minuteToTimeString(trigger.minute),
        days: trigger.days.map(dayLabel).join(' '),
      });
    case 'person-arrived':
      return t('automations.desc.personArrived', { who: personName(ctx, trigger.userId) });
    case 'person-left':
      return t('automations.desc.personLeft', { who: personName(ctx, trigger.userId) });
    case 'mode-changed':
      return t('automations.desc.modeChanged', { mode: t(MODE_LABEL_KEYS[trigger.mode]) });
  }
}

/** Frase legible de una acción ("entonces…"). Interpola frases completas por idioma. */
export function describeAction(action: AutomationAction, ctx: NameContext = {}): string {
  switch (action.type) {
    case 'iot-set': {
      const target = action.deviceId
        ? iotName(ctx, action.deviceId)
        : t('automations.desc.eventDevice');
      if (action.brightness !== undefined) {
        return t(
          action.on === false ? 'automations.desc.turnOffBright' : 'automations.desc.turnOnBright',
          { target, brightness: action.brightness },
        );
      }
      return t(action.on === false ? 'automations.desc.turnOff' : 'automations.desc.turnOn', {
        target,
      });
    }
    case 'scene-run':
      return t('automations.desc.sceneRun', {
        scene: ctx.scenes?.find((s) => s.id === action.sceneId)?.name ?? action.sceneId,
      });
    case 'device-block':
      return t('automations.desc.block', {
        target: action.mac ? macName(ctx, action.mac) : t('automations.desc.eventDevice'),
      });
    case 'device-pause':
      return t('automations.desc.pause', {
        target: action.mac ? macName(ctx, action.mac) : t('automations.desc.eventDevice'),
        minutes: action.minutes,
      });
    case 'notify':
      return t('automations.desc.notify', { message: action.message });
  }
}

/** Frase legible de la condición ("solo…"), o `null` si no hay. */
export function describeCondition(condition: AutomationCondition | undefined): string | null {
  if (!condition) return null;
  const parts: string[] = [];
  if (condition.days && condition.days.length < 7) {
    parts.push(condition.days.map(dayLabel).join(' '));
  }
  if (condition.fromMinute !== undefined && condition.toMinute !== undefined) {
    parts.push(
      `${minuteToTimeString(condition.fromMinute)}–${minuteToTimeString(condition.toMinute)}`,
    );
  }
  return parts.length > 0 ? t('automations.desc.only', { parts: parts.join(' · ') }) : null;
}
