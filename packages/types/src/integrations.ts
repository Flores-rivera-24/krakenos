/**
 * Contrato del sistema de configuración de integraciones (US-140+).
 *
 * Permite configurar drivers e integraciones **desde la UI** (sin editar `.env`):
 * qué integración está activa por dominio y sus credenciales. Los secretos se
 * guardan cifrados en reposo (ver `secretbox`, US-139) y **nunca** se devuelven por
 * la API. Compartido por el agente (persistencia/validación) y la web (formularios).
 */

/** Dominios de integración configurables. Uno activo por dominio. */
export type IntegrationDomain =
  | 'driver'
  | 'vpn'
  | 'iot'
  | 'cameras'
  | 'firewall'
  | 'vlan'
  | 'qos'
  | 'dns';

/** Tipo de un campo de configuración (guía el render del formulario + validación). */
export type IntegrationFieldType =
  | 'text'
  | 'password'
  | 'number'
  | 'boolean'
  | 'select'
  | 'url'
  | 'host'
  | 'ip';

/** Definición técnica de un campo de configuración de una integración. */
export interface IntegrationField {
  /** Clave estable; coincide con la que espera el builder de config del agente. */
  key: string;
  type: IntegrationFieldType;
  required: boolean;
  /** Secreto → se cifra en reposo y jamás se devuelve por la API. */
  secret?: boolean;
  /** Valor por defecto sugerido. */
  default?: string | number | boolean;
  /** Opciones para `type: 'select'`. */
  options?: { value: string; label: string }[];
}

/** Esquema técnico de un `kind` dentro de un dominio: qué config necesita. */
export interface IntegrationKindSchema {
  domain: IntegrationDomain;
  /** Identificador del `kind` (p. ej. `openwrt`, `hue`, `pihole`). */
  kind: string;
  /** Etiqueta técnica para listados; la copia rica la aporta la guía de la web. */
  label: string;
  fields: IntegrationField[];
  /** Solo dominio `driver`: ¿este equipo permite gestionar el WiFi? */
  wifiSupported?: boolean;
  /** No requiere configuración (p. ej. `mock`/demo). */
  zeroConfig?: boolean;
}

/** Valores de configuración de un dominio (no-secretos en claro; secretos nunca aquí). */
export type IntegrationConfigValues = Record<string, string | number | boolean>;

/** Estado efectivo de la config de un dominio, tal como lo devuelve la API. */
export interface IntegrationConfigInfo {
  domain: IntegrationDomain;
  kind: string;
  enabled: boolean;
  /** Campos NO secretos en claro. Los secretos nunca aparecen aquí. */
  config: IntegrationConfigValues;
  /** Claves de los secretos que están guardados (sin revelar su valor). */
  secretsSet: string[];
  /** De dónde sale la config efectiva: guardada en DB, heredada de `.env`, o el default. */
  source: 'db' | 'env' | 'default';
  /** ISO 8601 de la última modificación (solo si viene de DB). */
  updatedAt?: string;
}

/** Cuerpo para guardar la config de un dominio. */
export interface SaveIntegrationConfigRequest {
  kind: string;
  enabled?: boolean;
  /**
   * Valores de los campos. Los secretos van en claro (se cifran al guardar). **Omite**
   * un secreto para conservar el ya guardado (así la UI no reenvía contraseñas).
   */
  config: IntegrationConfigValues;
}

/** Resultado de probar la conexión de una integración antes de guardarla. */
export interface IntegrationTestResult {
  ok: boolean;
  /** Mensaje legible: éxito con detalle, o el error traducido a lenguaje llano. */
  message: string;
  /** Detalle opcional, p. ej. `{ dispositivos: 4 }`. */
  details?: Record<string, string | number>;
}
