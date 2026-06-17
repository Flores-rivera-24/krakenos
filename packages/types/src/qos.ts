import type { Id, IsoDateTime } from './common.js';

/** Implementaciones de gestor de QoS disponibles. */
export type QosKind = 'mock' | 'tc';

/** Nivel de prioridad de la regla de QoS. */
export type QosPriority = 'high' | 'normal' | 'low';

/**
 * Regla de QoS: prioriza y/o limita el ancho de banda de un dispositivo o
 * servicio. Un `downloadKbps`/`uploadKbps` de `0` significa sin límite.
 */
export interface QosRule {
  id: Id;
  name: string;
  priority: QosPriority;
  /** Objetivo: IP, CIDR o MAC del dispositivo, o nombre de servicio. */
  target: string;
  /** Límite de descarga en kbps; `0` = sin límite. */
  downloadKbps: number;
  /** Límite de subida en kbps; `0` = sin límite. */
  uploadKbps: number;
  enabled: boolean;
  createdAt: IsoDateTime;
}

export interface CreateQosRuleRequest {
  name: string;
  target: string;
  /** Por defecto `'normal'`. */
  priority?: QosPriority;
  /** Por defecto `0` (sin límite). */
  downloadKbps?: number;
  /** Por defecto `0` (sin límite). */
  uploadKbps?: number;
  /** Por defecto `true`. */
  enabled?: boolean;
}

/** Cambios parciales aplicables a una regla de QoS existente. */
export interface UpdateQosRuleRequest {
  name?: string;
  priority?: QosPriority;
  target?: string;
  downloadKbps?: number;
  uploadKbps?: number;
  enabled?: boolean;
}

/**
 * Gestor de QoS intercambiable. La implementación real (`tc`) configura el
 * control de tráfico del kernel vía un helper privilegiado; `mock` mantiene
 * las reglas en memoria.
 */
export interface QosManager {
  listRules(): Promise<QosRule[]>;
  getRule(id: Id): Promise<QosRule | null>;
  createRule(input: CreateQosRuleRequest): Promise<QosRule>;
  updateRule(id: Id, patch: UpdateQosRuleRequest): Promise<QosRule | null>;
  removeRule(id: Id): Promise<boolean>;
}
