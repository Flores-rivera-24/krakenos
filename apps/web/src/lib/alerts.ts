import type { AlertEvent, AlertRule, UpdateAlertRuleRequest } from '@krakenos/types';
import { api } from '@/lib/api';
import type { TranslationKey } from '@/lib/i18n';

/** Cliente de las reglas de alerta (US-112). */

/**
 * Etiqueta de cada evento alertable (US-270).
 *
 * Es un `Record<AlertEvent, …>` **exhaustivo a propósito**: añadir un evento al
 * catálogo de `@krakenos/types` **no compila** hasta darle su clave aquí, y la
 * clave no existe hasta estar en los dos catálogos de idioma. Es el mismo seguro
 * que `IOT_SUPPORT_LEVEL` sobre `IotKind` y que el mapa de cargadores de i18n
 * sobre `Locale`: la alternativa —una tabla que se rellena a mano— deja el evento
 * nuevo sin etiqueta, y una fila sin nombre en Ajustes → Alertas es un conmutador
 * que nadie sabe qué apaga.
 *
 * Antes la etiqueta la mandaba el agente dentro de la respuesta, escrita en
 * español: con la app en inglés, las trece filas y sus `aria-label` salían en
 * español.
 */
export const ETIQUETA_DE_ALERTA: Record<AlertEvent, TranslationKey> = {
  'auth.login_failed': 'alertEvent.auth.loginFailed',
  'auth.login_locked': 'alertEvent.auth.loginLocked',
  'auth.refresh_reuse': 'alertEvent.auth.refreshReuse',
  'auth.recovery_used': 'alertEvent.auth.recoveryUsed',
  'device.block': 'alertEvent.device.block',
  'inventory.unknown_device': 'alertEvent.inventory.unknownDevice',
  'dns.new_destination': 'alertEvent.dns.newDestination',
  'energy.threshold': 'alertEvent.energy.threshold',
  'camera.motion': 'alertEvent.camera.motion',
  'alarm.triggered': 'alertEvent.alarm.triggered',
  'alarm.smoke': 'alertEvent.alarm.smoke',
  'alarm.co': 'alertEvent.alarm.co',
  'alarm.sensor_fault': 'alertEvent.alarm.sensorFault',
  'alarm.disarm_denied': 'alertEvent.alarm.disarmDenied',
  'system.tls_expiring': 'alertEvent.system.tlsExpiring',
};

/**
 * Clave de traducción de un evento, o `null` si no está en el catálogo.
 *
 * Devuelve `null` en vez de caer al propio identificador porque `event` viene del
 * servidor y es un `string`: si una versión del agente más nueva anuncia un evento
 * que esta web no conoce, enseñar `alarm.foo` crudo en una tabla de ajustes es
 * peor que decir que no se reconoce.
 */
export function claveDeAlerta(event: string): TranslationKey | null {
  return ETIQUETA_DE_ALERTA[event as AlertEvent] ?? null;
}

export const listAlertRules = (): Promise<AlertRule[]> => api.getList<AlertRule>('/alerts/rules');

export const updateAlertRule = (event: string, body: UpdateAlertRuleRequest): Promise<AlertRule> =>
  api.patch<AlertRule>(`/alerts/rules/${encodeURIComponent(event)}`, body);
