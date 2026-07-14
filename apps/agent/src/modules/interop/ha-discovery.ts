import type { IotColor, IotDeviceKind, UpdateIotStateRequest } from '@krakenos/types';

/**
 * MQTT Discovery de Home Assistant (US-213), **puro y testeable**. Traduce la foto
 * del hogar a las configs de discovery **retained** (`homeassistant/…/config`) que
 * HA descubre solo, a los mensajes de estado que HA lee, y parsea los comandos
 * entrantes (`<prefijo>/iot/<id>/set`) a un `setState`.
 *
 * Reglas duras:
 * - **Privacidad (US-169):** del modo del hogar viaja SOLO el modo, nunca personas.
 * - **Publicar ≠ controlar:** los `command_topic` solo se declaran si el control
 *   entrante está activo; sin él, las entidades son de solo lectura (un `switch`
 *   sin `command_topic`), para no fingir en HA un control que no aceptamos.
 */

/** Dispositivo IoT tal como lo ve la publicación (sin PII: ni MAC ni IP). */
export interface SnapshotIotDevice {
  id: string;
  name: string;
  kind: IotDeviceKind;
  on: boolean | null;
  /** Brillo 0-100, o `null`. */
  brightness: number | null;
  color: IotColor | null;
  powerW?: number | null;
}

/** Foto del estado del hogar que se publica (sin secretos ni PII cruda). */
export interface StateSnapshot {
  iot: SnapshotIotDevice[];
  energy: { todayKwh: number; todayCost: number; currency: string } | null;
  /** Nº de dispositivos de red en línea (resumen, sin MAC/IP). */
  devicesOnline: number;
  /** Modo del hogar (US-169): SOLO el modo (`home`/`away`/`night`), nunca personas. */
  homeMode: string | null;
  /** Fase de la alarma (US-188: `disarmed`/`armed`/…), o `null`. */
  alarmPhase: string | null;
}

/** Un mensaje MQTT a publicar. `payload:''` con `retain` borra un retenido. */
export interface MqttMessage {
  topic: string;
  payload: string;
  retain?: boolean;
}

const DISCOVERY_PREFIX = 'homeassistant';
const HUB_ID = 'krakenos_hub';

/** Bloque `device` del hub (agrupa los sensores del hogar en HA). */
function hubDevice() {
  return { identifiers: [HUB_ID], name: 'KrakenOS', manufacturer: 'KrakenOS', model: 'Home Control' };
}

/** Bloque `device` de un aparato IoT concreto (entidad propia en HA). */
function iotDevice(dev: SnapshotIotDevice) {
  return {
    identifiers: [`krakenos_iot_${dev.id}`],
    name: dev.name,
    manufacturer: 'KrakenOS',
    via_device: HUB_ID,
  };
}

/** Sanea un id para un nivel de topic (sin `/`, `+`, `#`, espacios). */
export function encodeTopic(id: string): string {
  return id.replace(/[/+#\s]/g, '_');
}

/** Objeto de discovery HA-estable para un id de dispositivo (alfanumérico/`_`/`-`). */
function objectId(id: string): string {
  return id.replace(/[^\w-]/g, '_');
}

/**
 * Cómo se expone un IoT en HA. Un `light` solo es una entidad `light` (con brillo/
 * color) si el **control entrante está activo** (HA exige `command_topic` en un
 * `light`); sin control, se muestra como `switch` de solo lectura (on/off).
 */
export type IotExposure =
  | { component: 'switch'; controllable: boolean }
  | { component: 'light'; brightness: boolean; color: boolean };

export function exposureFor(dev: SnapshotIotDevice, controlEnabled: boolean): IotExposure | null {
  if (dev.kind === 'sensor' || dev.on === null) return null; // sensores no son on/off
  if (dev.kind === 'light' && controlEnabled) {
    return { component: 'light', brightness: dev.brightness !== null, color: dev.color !== null };
  }
  return { component: 'switch', controllable: controlEnabled };
}

/** Topic de config de discovery para un `component`/`object`. */
function configTopic(component: string, object: string): string {
  return `${DISCOVERY_PREFIX}/${component}/krakenos/${object}/config`;
}

/**
 * Configs de discovery **retained** para el estado actual. Cada dispositivo IoT
 * controlable + los sensores del hub (energía, modo, alarma, online) + el sensor
 * de potencia por aparato que la mida.
 */
export function buildDiscoveryConfigs(
  snapshot: StateSnapshot,
  prefix: string,
  controlEnabled: boolean,
): MqttMessage[] {
  const msgs: MqttMessage[] = [];
  const avail = {
    availability_topic: `${prefix}/status`,
    payload_available: 'online',
    payload_not_available: 'offline',
  };

  for (const dev of snapshot.iot) {
    const t = `${prefix}/iot/${encodeTopic(dev.id)}`;
    const exp = exposureFor(dev, controlEnabled);
    if (exp) {
      const base: Record<string, unknown> = {
        name: dev.name,
        unique_id: `krakenos_iot_${objectId(dev.id)}`,
        state_topic: `${t}/state`,
        payload_on: 'ON',
        payload_off: 'OFF',
        ...avail,
        device: iotDevice(dev),
      };
      if (exp.component === 'switch') {
        if (exp.controllable) base.command_topic = `${t}/set`;
        msgs.push({ topic: configTopic('switch', `iot_${objectId(dev.id)}`), payload: JSON.stringify(base), retain: true });
      } else {
        base.command_topic = `${t}/set`; // el light siempre es controlable aquí
        if (exp.brightness) {
          base.brightness_state_topic = `${t}/brightness`;
          base.brightness_command_topic = `${t}/brightness/set`;
          base.brightness_scale = 100;
        }
        if (exp.color) {
          base.rgb_state_topic = `${t}/rgb`;
          base.rgb_command_topic = `${t}/rgb/set`;
        }
        msgs.push({ topic: configTopic('light', `iot_${objectId(dev.id)}`), payload: JSON.stringify(base), retain: true });
      }
    }
    // Sensor de potencia instantánea, si el aparato la mide.
    if (dev.powerW !== undefined && dev.powerW !== null) {
      msgs.push({
        topic: configTopic('sensor', `iot_${objectId(dev.id)}_power`),
        payload: JSON.stringify({
          name: `${dev.name} potencia`,
          unique_id: `krakenos_iot_${objectId(dev.id)}_power`,
          state_topic: `${t}/power`,
          unit_of_measurement: 'W',
          device_class: 'power',
          state_class: 'measurement',
          ...avail,
          device: iotDevice(dev),
        }),
        retain: true,
      });
    }
  }

  // Sensores del hub.
  if (snapshot.energy) {
    msgs.push({
      topic: configTopic('sensor', 'energy_today'),
      payload: JSON.stringify({
        name: 'Energía hoy',
        unique_id: 'krakenos_energy_today',
        state_topic: `${prefix}/energy/today_kwh`,
        unit_of_measurement: 'kWh',
        device_class: 'energy',
        state_class: 'total_increasing',
        ...avail,
        device: hubDevice(),
      }),
      retain: true,
    });
  }
  if (snapshot.homeMode !== null) {
    msgs.push({
      topic: configTopic('sensor', 'home_mode'),
      payload: JSON.stringify({
        name: 'Modo del hogar',
        unique_id: 'krakenos_home_mode',
        state_topic: `${prefix}/home/mode`,
        icon: 'mdi:home-account',
        ...avail,
        device: hubDevice(),
      }),
      retain: true,
    });
  }
  if (snapshot.alarmPhase !== null) {
    msgs.push({
      topic: configTopic('sensor', 'alarm'),
      payload: JSON.stringify({
        name: 'Alarma',
        unique_id: 'krakenos_alarm',
        state_topic: `${prefix}/alarm/state`,
        icon: 'mdi:shield-home',
        ...avail,
        device: hubDevice(),
      }),
      retain: true,
    });
  }
  msgs.push({
    topic: configTopic('sensor', 'devices_online'),
    payload: JSON.stringify({
      name: 'Dispositivos en línea',
      unique_id: 'krakenos_devices_online',
      state_topic: `${prefix}/devices/online`,
      state_class: 'measurement',
      ...avail,
      device: hubDevice(),
    }),
    retain: true,
  });

  return msgs;
}

/** Solo los topics de config (para el diff de limpieza de retenidos). */
export function discoveryConfigTopics(
  snapshot: StateSnapshot,
  prefix: string,
  controlEnabled: boolean,
): string[] {
  return buildDiscoveryConfigs(snapshot, prefix, controlEnabled).map((m) => m.topic);
}

/** Mensaje retenido que **borra** una config de discovery (payload vacío). */
export function removalMessage(topic: string): MqttMessage {
  return { topic, payload: '', retain: true };
}

/** Estado en los topics que las configs de discovery referencian (retenido). */
export function buildStateMessages(snapshot: StateSnapshot, prefix: string): MqttMessage[] {
  const msgs: MqttMessage[] = [{ topic: `${prefix}/status`, payload: 'online', retain: true }];
  for (const dev of snapshot.iot) {
    const t = `${prefix}/iot/${encodeTopic(dev.id)}`;
    if (dev.on !== null) msgs.push({ topic: `${t}/state`, payload: dev.on ? 'ON' : 'OFF', retain: true });
    if (dev.brightness !== null) msgs.push({ topic: `${t}/brightness`, payload: String(dev.brightness), retain: true });
    if (dev.color?.hex) msgs.push({ topic: `${t}/rgb`, payload: hexToRgb(dev.color.hex), retain: true });
    if (dev.powerW !== undefined && dev.powerW !== null) {
      msgs.push({ topic: `${t}/power`, payload: String(dev.powerW), retain: true });
    }
  }
  if (snapshot.energy) {
    msgs.push({ topic: `${prefix}/energy/today_kwh`, payload: snapshot.energy.todayKwh.toFixed(3), retain: true });
  }
  if (snapshot.homeMode !== null) msgs.push({ topic: `${prefix}/home/mode`, payload: snapshot.homeMode, retain: true });
  if (snapshot.alarmPhase !== null) msgs.push({ topic: `${prefix}/alarm/state`, payload: snapshot.alarmPhase, retain: true });
  msgs.push({ topic: `${prefix}/devices/online`, payload: String(snapshot.devicesOnline), retain: true });
  return msgs;
}

/** Filtros a los que suscribirse para el control entrante (US-213). */
export function commandFilters(prefix: string): string[] {
  return [`${prefix}/iot/+/set`, `${prefix}/iot/+/brightness/set`, `${prefix}/iot/+/rgb/set`];
}

/**
 * Parsea un comando entrante a `{deviceId, state}`, o `null` si el topic/payload no
 * es un comando válido (defensivo: un payload basura no debe lanzar).
 */
export function parseInboundCommand(
  topic: string,
  payload: string,
  prefix: string,
): { deviceId: string; state: UpdateIotStateRequest } | null {
  const parts = topic.split('/');
  if (parts[0] !== prefix || parts[1] !== 'iot') return null;
  const deviceId = parts[2];
  if (!deviceId) return null;
  const rest = parts.slice(3).join('/');
  const body = payload.trim();

  if (rest === 'set') {
    const v = body.toUpperCase();
    if (v === 'ON' || v === 'TRUE' || v === '1') return { deviceId, state: { on: true } };
    if (v === 'OFF' || v === 'FALSE' || v === '0') return { deviceId, state: { on: false } };
    return null;
  }
  if (rest === 'brightness/set') {
    const n = Number(body);
    if (!Number.isFinite(n)) return null;
    return { deviceId, state: { brightness: Math.max(0, Math.min(100, Math.round(n))) } };
  }
  if (rest === 'rgb/set') {
    const hex = rgbToHex(body);
    if (!hex) return null;
    return { deviceId, state: { color: { hex } } };
  }
  return null;
}

/** `#rrggbb` → `"r,g,b"` (para el rgb de HA). */
export function hexToRgb(hex: string): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m?.[1]) return '0,0,0';
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

/** `"r,g,b"` → `#rrggbb`, o `null` si no es un triple 0-255 válido. */
export function rgbToHex(rgb: string): string | null {
  const parts = rgb.split(',').map((s) => Number(s.trim()));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return null;
  return '#' + parts.map((n) => Math.round(n).toString(16).padStart(2, '0')).join('');
}
