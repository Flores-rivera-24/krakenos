/**
 * Modelo de contenido de las guías de conexión in-app (US-144).
 *
 * Estos tipos son el **contrato** entre el contenido que escribe el equipo de
 * UX (los datos de `integrations/`) y quien los consume: el backend que persiste
 * la config del dispositivo y el asistente (wizard) de la UI que la recoge paso a
 * paso. La forma de estos tipos NO debe cambiar sin coordinar ambos lados.
 *
 * Es solo datos + tipos: nada de React aquí. Las guías se escriben en español
 * llano, pensadas para alguien que nunca ha oído hablar de una dirección IP.
 */

/** Familia funcional a la que pertenece la integración (mapea al dominio del backend). */
export type GuideDomain = 'driver' | 'iot' | 'vpn' | 'camera' | 'dns' | 'firewall' | 'vlan' | 'qos';

/** Agrupación pensada para la persona: qué está conectando, no cómo. */
export type GuideCategory =
  | 'router'
  | 'lights'
  | 'plugs'
  | 'cameras'
  | 'remote-access'
  | 'ad-blocking'
  | 'firewall'
  | 'vlan'
  | 'qos';

/** Tipo de dato de un campo del formulario del asistente. */
export type GuideFieldType =
  | 'text'
  | 'password'
  | 'number'
  | 'select'
  | 'boolean'
  | 'url'
  | 'host'
  | 'ip';

/** Un campo de configuración que el asistente pide a la persona. */
export interface GuideField {
  /** DEBE coincidir con la clave de config del backend (ver el mapeo kind→config). */
  key: string;
  /** Etiqueta en lenguaje natural. */
  label: string;
  /** Explicación llana: qué es + DÓNDE encontrarlo. */
  help: string;
  type: GuideFieldType;
  placeholder?: string;
  required: boolean;
  /** true → se guarda cifrado y nunca se vuelve a mostrar (contraseñas, claves API, local keys). */
  secret?: boolean;
  /** Opciones para los campos de tipo `select`. */
  options?: { value: string; label: string }[];
  defaultValue?: string | number | boolean;
}

/** Un paso de la narrativa de conexión. */
export interface GuideStep {
  title: string;
  /** Instrucciones en lenguaje llano (párrafos cortos; sin jerga sin explicar). */
  body: string;
  /** Comando o fragmento copiable, opcional. */
  command?: string;
  note?: string;
  warning?: string;
  /** true si la acción ocurre FUERA de la app (en el dispositivo o el servidor), no en un formulario. */
  external?: boolean;
}

/** Una guía completa para conectar/usar una integración. */
export interface IntegrationGuide {
  /** slug, p. ej. 'hue', 'openwrt', 'rtsp'. */
  id: string;
  domain: GuideDomain;
  /** El string `kind` del backend (valores exactos del mapeo). */
  kind: string;
  category: GuideCategory;
  /** Nombre visible, p. ej. "Philips Hue". */
  displayName: string;
  vendor?: string;
  /** Nombre de un icono de lucide-react como string, p. ej. 'Lightbulb', 'Router', 'Camera'. */
  icon: string;
  /** Complejidad para una persona no técnica (1 = lo más fácil). */
  tier: 1 | 2 | 3 | 4;
  /** "qué es esto / qué podrás hacer una vez conectado", cálido y llano. */
  intro: string;
  /** En lenguaje llano: qué necesitas antes de empezar. */
  prerequisites: string[];
  /** Narrativa ordenada para conectarlo (internalizada del doc). */
  steps: GuideStep[];
  /** La config que recoge el asistente (alineada con la config del `kind` del backend). */
  fields: GuideField[];
  troubleshooting: { q: string; a: string }[];
  /** Solo drivers: ¿este dispositivo deja que KrakenOS gestione la WiFi? */
  wifiSupported?: boolean;
}
