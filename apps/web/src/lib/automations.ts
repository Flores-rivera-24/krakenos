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
import { DAY_LABELS, minuteToTimeString } from '@/lib/iot-schedules';
import { MODE_LABELS } from '@/lib/presence';

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

/** Frase legible del disparador ("Cuando…"). */
export function describeTrigger(trigger: AutomationTrigger, ctx: NameContext = {}): string {
  switch (trigger.type) {
    case 'device-new':
      return 'aparece un dispositivo desconocido';
    case 'device-online':
      return `${macName(ctx, trigger.mac)} se conecta`;
    case 'device-offline':
      return `${macName(ctx, trigger.mac)} se desconecta`;
    case 'iot-on':
      return `${iotName(ctx, trigger.deviceId)} se enciende`;
    case 'iot-off':
      return `${iotName(ctx, trigger.deviceId)} se apaga`;
    case 'sensor-threshold':
      return `${iotName(ctx, trigger.deviceId)} ${trigger.op === 'gt' ? 'supera' : 'baja de'} ${trigger.value}`;
    case 'energy-threshold':
      return `${trigger.deviceId ? iotName(ctx, trigger.deviceId) : 'un aparato'} supera su umbral de consumo`;
    case 'time':
      return `a las ${minuteToTimeString(trigger.minute)} (${trigger.days.map((d) => DAY_LABELS[d]).join(' ')})`;
    case 'person-arrived':
      return `${trigger.userId ? (ctx.userNames?.get(trigger.userId) ?? trigger.userId) : 'alguien'} llega a casa`;
    case 'person-left':
      return `${trigger.userId ? (ctx.userNames?.get(trigger.userId) ?? trigger.userId) : 'alguien'} sale de casa`;
    case 'mode-changed':
      return `el hogar pasa a «${MODE_LABELS[trigger.mode]}»`;
  }
}

/** Frase legible de una acción ("entonces…"). */
export function describeAction(action: AutomationAction, ctx: NameContext = {}): string {
  switch (action.type) {
    case 'iot-set': {
      const target = action.deviceId ? iotName(ctx, action.deviceId) : 'el dispositivo del evento';
      const state = action.on === false ? 'apaga' : 'enciende';
      const dim = action.brightness !== undefined ? ` al ${action.brightness}%` : '';
      return `${state} ${target}${dim}`;
    }
    case 'scene-run':
      return `activa la escena ${ctx.scenes?.find((s) => s.id === action.sceneId)?.name ?? action.sceneId}`;
    case 'device-block':
      return `bloquea ${action.mac ? macName(ctx, action.mac) : 'el dispositivo del evento'}`;
    case 'device-pause':
      return `pausa ${action.mac ? macName(ctx, action.mac) : 'el dispositivo del evento'} ${action.minutes} min`;
    case 'notify':
      return `avisa: «${action.message}»`;
  }
}

/** Frase legible de la condición ("solo…"), o `null` si no hay. */
export function describeCondition(condition: AutomationCondition | undefined): string | null {
  if (!condition) return null;
  const parts: string[] = [];
  if (condition.days && condition.days.length < 7) {
    parts.push(condition.days.map((d) => DAY_LABELS[d]).join(' '));
  }
  if (condition.fromMinute !== undefined && condition.toMinute !== undefined) {
    parts.push(
      `${minuteToTimeString(condition.fromMinute)}–${minuteToTimeString(condition.toMinute)}`,
    );
  }
  return parts.length > 0 ? `solo ${parts.join(' · ')}` : null;
}
