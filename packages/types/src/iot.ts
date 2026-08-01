import type { Id } from './common.js';

/**
 * Categoría de dispositivo IoT (US-244). Deriva del array para que los enums de
 * las rutas y los schemas no se re-tecleen (convención del proyecto).
 *
 * `contact` y `smoke` son categorías propias y **no** `sensor` genérico a
 * propósito: son las que la alarma vigila, y mezclarlas con «un número que
 * cambia» es justo lo que hacía que un enchufe con medidor de consumo pudiera
 * dispararla. Un `sensor` mide magnitudes (temperatura, humedad, luz); un
 * `contact` dice si algo está abierto.
 */
export const IOT_DEVICE_KINDS = [
  'light',
  'plug',
  'sensor',
  'climate',
  'cover',
  'lock',
  'contact',
  'smoke',
] as const;
export type IotDeviceKind = (typeof IOT_DEVICE_KINDS)[number];

/**
 * Categorías que aceptan **escritura** (US-244). El resto son de solo lectura: un
 * sensor de contacto o un detector de humo no se «apagan».
 *
 * ⚠️ **`lock` no está aquí a propósito, y no es un olvido**: se lee pero no se
 * escribe hasta que US-246 decida la política de desbloqueo. Un fallo en esa ruta
 * abre la puerta de la calle, así que la superficie no existe en vez de existir
 * sin haberla pensado. Añadir `lock` a esta lista es **la** decisión de US-246.
 */
export const CONTROLLABLE_IOT_KINDS = ['light', 'plug', 'cover', 'climate'] as const;
export type ControllableIotKind = (typeof CONTROLLABLE_IOT_KINDS)[number];

/** ¿Acepta este tipo de dispositivo órdenes de cambio de estado? */
export function isControllableKind(kind: IotDeviceKind): kind is ControllableIotKind {
  return (CONTROLLABLE_IOT_KINDS as readonly string[]).includes(kind);
}

/** Implementaciones de integración IoT disponibles. */
export type IotKind =
  | 'mock'
  | 'zigbee'
  | 'matter'
  | 'hue'
  | 'govee'
  | 'tuya'
  | 'kasa'
  | 'shelly'
  | 'meross';

/**
 * Magnitudes que puede reportar un dispositivo (US-244). Unión **cerrada**, y ese
 * es el punto de la historia: `metric` era antes un `string` libre con el nombre
 * en español («temperatura»), así que ningún consumidor podía distinguir «se ha
 * abierto una puerta» de «este enchufe consume 5 W». La alarma lo resolvía
 * mirando si el número cruzaba 1 — y encendía con una lámpara.
 *
 * Las cuatro últimas son **de seguridad** (`METRICAS_DE_SEGURIDAD`): significan un
 * suceso, no una magnitud. El resto son medidas y no disparan nada por sí solas.
 */
export const IOT_METRICS = [
  'temperature',
  'humidity',
  'power',
  'energy',
  'battery',
  'illuminance',
  'contact',
  'occupancy',
  'smoke',
  'co',
] as const;
export type IotMetric = (typeof IOT_METRICS)[number];

/**
 * Métricas que representan un **suceso vigilable** y no una magnitud: son las
 * únicas que pueden disparar la alarma (US-244). `1` = activo (abierto, presencia
 * detectada, humo), `0` = reposo.
 */
export const SECURITY_METRICS = ['contact', 'occupancy', 'smoke', 'co'] as const;
export type SecurityMetric = (typeof SECURITY_METRICS)[number];

/** ¿Es esta métrica un suceso de seguridad y no una simple medida? */
export function isSecurityMetric(metric: IotMetric): metric is SecurityMetric {
  return (SECURITY_METRICS as readonly string[]).includes(metric);
}

/**
 * Lectura de un dispositivo. `unit` es solo presentación (la UI la pinta tal
 * cual); quien tenga que **decidir** algo mira `metric`, nunca `unit`.
 */
export interface IotReading {
  metric: IotMetric;
  value: number;
  unit: string;
}

/**
 * Color de una luz. Una luz con color tiene `IotColor`; las que no lo soportan
 * (enchufes, luces solo-blanco-fijo) lo dejan en `null`. Modo color → `hex`;
 * modo blanco regulable → `temperatureK` (en Kelvin). Solo uno está activo.
 */
export interface IotColor {
  /** Color RGB en hex (`#rrggbb`) cuando la luz está en modo color; `null` si no. */
  hex: string | null;
  /** Temperatura de color en Kelvin (modo blanco); `null` si está en modo color. */
  temperatureK: number | null;
}

/** Dispositivo IoT gestionado por el agente. */
export interface IotDevice {
  id: Id;
  name: string;
  kind: IotDeviceKind;
  /** Estancia donde está, si se conoce. */
  room: string | null;
  reachable: boolean;
  /** Encendido/apagado (light/plug); `null` para sensores. */
  on: boolean | null;
  /** Brillo 0-100 (light); `null` si no aplica. */
  brightness: number | null;
  /** Color (luces con color); `null` si la luz no soporta color o no es luz. */
  color: IotColor | null;
  /**
   * Lecturas actuales (US-244). Es una **lista** y no una lectura suelta porque
   * un aparato real reporta varias a la vez —un sensor de clima da temperatura,
   * humedad y batería— y con un solo hueco se perdían todas menos la primera. Un
   * aparato sin nada que medir tiene `[]`, nunca `null`: distinguir «lista vacía»
   * de «no aplica» no le servía a ningún consumidor.
   */
  readings: IotReading[];
  /**
   * Posición de una persiana/toldo, 0 (cerrada) a 100 (abierta). `null` si no es
   * un `cover` o el backend no la reporta.
   */
  position?: number | null;
  /** Temperatura objetivo en °C de un `climate`; `null` si no aplica. */
  targetC?: number | null;
  /**
   * ¿Está echada la cerradura? `null` si no es un `lock` o se desconoce.
   * ⚠️ Solo **lectura**: abrir una cerradura por API no se expone hasta que
   * US-246 decida la política (un fallo aquí abre la puerta de la calle).
   */
  locked?: boolean | null;
  /**
   * Potencia instantánea en vatios, si el dispositivo la mide (Shelly, Tapo/Kasa,
   * Meross, el mock la simula); `undefined`/`null` si el backend no la reporta
   * (US-181). La medición de energía (`EnergySample`) la integra en el tiempo.
   */
  powerW?: number | null;
  /**
   * Contador de energía acumulada en Wh que reportan algunos dispositivos
   * (Shelly `aenergy.total`); `undefined`/`null` si no lo miden (US-181).
   */
  energyWh?: number | null;
}

/**
 * Cambios de estado aplicables a un dispositivo controlable (US-244).
 *
 * ⚠️ **No hay campo para la cerradura.** `lock` se lee pero no se escribe hasta
 * que US-246 decida la política de desbloqueo: un fallo aquí abre la puerta de la
 * calle, así que la superficie no existe en vez de existir sin decidir.
 */
export interface UpdateIotStateRequest {
  on?: boolean;
  brightness?: number;
  /** Cambia el color (hex `#rrggbb`) o la temperatura (Kelvin); excluyentes. */
  color?: { hex?: string; temperatureK?: number };
  /** Posición objetivo de un `cover`, 0 (cerrar) a 100 (abrir). */
  position?: number;
  /** Temperatura objetivo de un `climate`, en °C. */
  targetC?: number;
}

/**
 * Integración IoT intercambiable. La implementación real hablaría con
 * Zigbee/Matter/Wi-Fi; `mock` simula en memoria.
 */
export interface IotManager {
  listDevices(): Promise<IotDevice[]>;
  getDevice(id: Id): Promise<IotDevice | null>;
  /** Aplica el cambio de estado a un dispositivo controlable. */
  setState(id: Id, input: UpdateIotStateRequest): Promise<IotDevice>;
  /**
   * Libera la conexión persistente del backend (MQTT/UDP/WS) si la hay. Lo
   * invoca `disposeManager` al recargar la integración en caliente para no
   * fugar la instancia saliente (US-201).
   */
  stop?(): Promise<void>;
  /**
   * Comisiona un dispositivo Matter nuevo a partir de su QR o código de
   * emparejamiento (US-172). Solo lo implementan los backends Matter; el
   * composite lo delega en su miembro Matter. Ausente = no soportado.
   */
  commission?(code: string): Promise<MatterCommissionResult>;
}

/**
 * Resultado de comisionar un dispositivo Matter (US-172): el nodo recién añadido
 * al controlador (python-matter-server). El `deviceId` ya viene con el prefijo del
 * composite si aplica (p. ej. `matter:5`).
 */
export interface MatterCommissionResult {
  deviceId: Id;
  name: string;
}

/**
 * Código de error de comisionado Matter, para traducir a un mensaje amable en la
 * UI (US-172). `invalid-code` = QR/código mal; `not-found` = dispositivo lejos o
 * inalcanzable; `thread-no-border` = dispositivo Thread sin border router; `failed`
 * = fallo genérico.
 */
export type MatterCommissionErrorCode =
  | 'invalid-code'
  | 'not-found'
  | 'thread-no-border'
  | 'failed';

/** Versiones del protocolo local Tuya soportadas. */
export type TuyaProtocolVersion = '3.1' | '3.3' | '3.4' | '3.5';

/** Vista pública de un foco Tuya registrado: **nunca** incluye `localKey` (US-32/42). */
export interface TuyaDeviceView {
  deviceId: string;
  ip: string;
  name: string;
  version?: TuyaProtocolVersion;
}

/** Alta de un foco Tuya (`POST /api/iot/tuya/devices`). */
export interface CreateTuyaDeviceRequest {
  deviceId: string;
  localKey: string;
  ip: string;
  name: string;
  version?: TuyaProtocolVersion;
}

/** Cambios parciales de un foco Tuya (`PATCH /api/iot/tuya/devices/:deviceId`). */
export interface UpdateTuyaDeviceRequest {
  ip?: string;
  localKey?: string;
  name?: string;
}
