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

/**
 * Dispositivo de red con su **bloqueo efectivo** (US-236). Se nombra por
 * `label`/`hostname`, **nunca por MAC**: el `name` acaba en el *entity registry* de
 * HA (que no se limpia al borrar la entidad) y en su recorder.
 */
export interface SnapshotBlockedDevice {
  /** `Device.id` (cuid, no-PII). */
  id: string;
  name: string;
  blocked: boolean;
  /** Por qué: `manual` · `schedule` · `paused`. Vacío si no está bloqueado. */
  reasons: string[];
}

/**
 * Peor señal WiFi observada en una habitación (US-236). Sustituye al sensor de
 * «cobertura», que **no es computable** (`Room` no guarda geometría) y que además
 * habría sido un modelo estático publicado como si fuera una medida.
 *
 * ⚠️ El estado es el dBm **y nada más**: publicar *qué aparato* es el peor sería
 * presencia por la puerta de atrás, porque `Device.ownerId` ata aparato→persona.
 */
export interface SnapshotRoomSignal {
  /** `Room.id`. */
  id: string;
  name: string;
  /** Peor (mínimo) `signalDbm` entre los aparatos WiFi **en línea** de la habitación. */
  worstDbm: number | null;
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
  /** Bloqueo efectivo por dispositivo (US-236). */
  blockedDevices: SnapshotBlockedDevice[];
  /** Peor señal WiFi por habitación (US-236). */
  roomSignals: SnapshotRoomSignal[];
}

/** Qué superficies de control entrante están activas. Cada una es un toggle propio. */
export interface ControlFlags {
  /** «HA puede tocar mis aparatos IoT» (US-213). */
  iot: boolean;
  /** «HA puede cortarle internet a un dispositivo» (US-236). Distinto y aparte. */
  pause: boolean;
}

/** Un mensaje MQTT a publicar. `payload:''` con `retain` borra un retenido. */
export interface MqttMessage {
  topic: string;
  payload: string;
  retain?: boolean;
}

const DISCOVERY_PREFIX = 'homeassistant';
const HUB_ID = 'krakenos_hub';

/** Payloads de disponibilidad (los mismos en el LWT, el arranque y el apagado). */
export const AVAILABILITY_ONLINE = 'online';
export const AVAILABILITY_OFFLINE = 'offline';

/** Duración del botón «pausar internet» de HA. */
export const DEFAULT_PAUSE_MINUTES = 30;
/** Cota dura de una pausa entrante por MQTT (el broker no tiene sujeto: no se fía). */
export const MAX_PAUSE_MINUTES = 24 * 60;

/** Topic de disponibilidad del hub. Es el que respalda el LWT. */
export function availabilityTopic(prefix: string): string {
  return `${prefix}/status`;
}

/**
 * Testamento (LWT) que se declara **al conectar**: si el agente muere sin
 * despedirse, el broker publica esto por nosotros y HA marca todas las entidades
 * como no disponibles.
 *
 * Sin esto, `<prefijo>/status` se quedaba retenido en `'online'` para siempre y
 * **Home Assistant seguía viendo la casa entera disponible con su último valor**,
 * aunque el agente llevara días caído (US-236).
 */
export function willMessage(prefix: string): MqttMessage {
  return { topic: availabilityTopic(prefix), payload: AVAILABILITY_OFFLINE, retain: true };
}

/** Adiós **limpio** (apagado ordenado): el LWT no se dispara si nos despedimos bien. */
export function offlineMessage(prefix: string): MqttMessage {
  return { topic: availabilityTopic(prefix), payload: AVAILABILITY_OFFLINE, retain: true };
}

/** Topic de disponibilidad propio de una habitación (sin aparatos WiFi → offline). */
function roomAvailabilityTopic(prefix: string, roomId: string): string {
  return `${prefix}/room/${encodeTopic(roomId)}/available`;
}

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
  // Sensores y, desde US-244, también `contact`/`smoke`/`cover`/`climate`/`lock`:
  // ninguno es on/off, así que `on === null` los descarta a todos. **Es correcto
  // pero no es completo**: HA tiene `binary_sensor` y `cover` nativos y publicar
  // ahí un sensor de apertura sería útil. Se deja fuera a propósito de esta
  // historia —que amplía el contrato, no la interop— y está anotado en el backlog.
  if (dev.kind === 'sensor' || dev.on === null) return null;
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
  control: ControlFlags,
): MqttMessage[] {
  const msgs: MqttMessage[] = [];
  const avail = {
    availability_topic: availabilityTopic(prefix),
    payload_available: AVAILABILITY_ONLINE,
    payload_not_available: AVAILABILITY_OFFLINE,
  };

  for (const dev of snapshot.iot) {
    const t = `${prefix}/iot/${encodeTopic(dev.id)}`;
    const exp = exposureFor(dev, control.iot);
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

  // --- La cuña (US-236): lo que solo KrakenOS sabe ---

  for (const dev of snapshot.blockedDevices) {
    const oid = objectId(dev.id);
    const t = `${prefix}/device/${encodeTopic(dev.id)}`;
    // «Internet bloqueado» por DISPOSITIVO, nunca por persona: nombrar a la
    // persona reintroduciría por MQTT la lista que la regla de US-169 prohíbe.
    msgs.push({
      topic: configTopic('binary_sensor', `device_${oid}_blocked`),
      payload: JSON.stringify({
        name: `${dev.name} · internet bloqueado`,
        unique_id: `krakenos_device_${oid}_blocked`,
        state_topic: `${t}/blocked`,
        payload_on: 'ON',
        payload_off: 'OFF',
        // Sin `device_class`: `connectivity` invertiría el significado (ON=conectado)
        // y `problem` diría que un corte programado es una avería. Un icono es honesto.
        icon: 'mdi:wifi-cancel',
        json_attributes_topic: `${t}/blocked/attributes`,
        ...avail,
        device: hubDevice(),
      }),
      retain: true,
    });

    // Botón de pausa: solo si su PROPIO toggle está activo. El `control` de IoT
    // significa «HA puede tocar mis aparatos», no «puede cortarle internet a mi
    // hija»: son permisos distintos y se piden por separado.
    if (control.pause) {
      msgs.push({
        topic: configTopic('button', `device_${oid}_pause`),
        payload: JSON.stringify({
          name: `${dev.name} · pausar internet 30 min`,
          unique_id: `krakenos_device_${oid}_pause`,
          command_topic: `${t}/pause/set`,
          payload_press: String(DEFAULT_PAUSE_MINUTES),
          icon: 'mdi:timer-pause-outline',
          ...avail,
          device: hubDevice(),
        }),
        retain: true,
      });
    }
  }

  for (const room of snapshot.roomSignals) {
    const oid = objectId(room.id);
    msgs.push({
      topic: configTopic('sensor', `room_${oid}_signal`),
      payload: JSON.stringify({
        // «señal de los aparatos de esta habitación», NO «cobertura»: el RSSI es el
        // que ve el punto de acceso, no el que ve el móvil.
        name: `${room.name} · señal de los aparatos`,
        unique_id: `krakenos_room_${oid}_signal`,
        state_topic: `${prefix}/room/${encodeTopic(room.id)}/signal`,
        unit_of_measurement: 'dBm',
        device_class: 'signal_strength',
        state_class: 'measurement',
        // Doble disponibilidad: el hub vivo **y** la habitación con algún aparato
        // WiFi en línea. Sin aparatos no se inventa un 0 ni un -100: no hay dato.
        availability: [
          { topic: availabilityTopic(prefix), payload_available: AVAILABILITY_ONLINE, payload_not_available: AVAILABILITY_OFFLINE },
          { topic: roomAvailabilityTopic(prefix, room.id), payload_available: AVAILABILITY_ONLINE, payload_not_available: AVAILABILITY_OFFLINE },
        ],
        availability_mode: 'all',
        device: hubDevice(),
      }),
      retain: true,
    });
  }

  return msgs;
}

/** Solo los topics de config (para el diff de limpieza de retenidos). */
export function discoveryConfigTopics(
  snapshot: StateSnapshot,
  prefix: string,
  control: ControlFlags,
): string[] {
  return buildDiscoveryConfigs(snapshot, prefix, control).map((m) => m.topic);
}

/** Mensaje retenido que **borra** una config de discovery (payload vacío). */
export function removalMessage(topic: string): MqttMessage {
  return { topic, payload: '', retain: true };
}

/** Estado en los topics que las configs de discovery referencian (retenido). */
export function buildStateMessages(snapshot: StateSnapshot, prefix: string): MqttMessage[] {
  const msgs: MqttMessage[] = [
    { topic: availabilityTopic(prefix), payload: AVAILABILITY_ONLINE, retain: true },
  ];
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

  // Bloqueo efectivo por dispositivo (US-236). El estado es el DERIVADO de las tres
  // fuentes, nunca la columna `Device.isBlocked`: con un horario activo esa columna
  // dice `false` mientras el driver sigue bloqueando.
  for (const dev of snapshot.blockedDevices) {
    const t = `${prefix}/device/${encodeTopic(dev.id)}`;
    msgs.push({ topic: `${t}/blocked`, payload: dev.blocked ? 'ON' : 'OFF', retain: true });
    msgs.push({
      topic: `${t}/blocked/attributes`,
      payload: JSON.stringify({ razones: dev.reasons }),
      retain: true,
    });
  }

  // Peor señal por habitación. Sin aparatos WiFi en línea, la habitación se declara
  // NO disponible en vez de publicar un número inventado.
  for (const room of snapshot.roomSignals) {
    const base = `${prefix}/room/${encodeTopic(room.id)}`;
    const hayDato = room.worstDbm !== null;
    msgs.push({
      topic: `${base}/available`,
      payload: hayDato ? AVAILABILITY_ONLINE : AVAILABILITY_OFFLINE,
      retain: true,
    });
    if (hayDato) msgs.push({ topic: `${base}/signal`, payload: String(room.worstDbm), retain: true });
  }

  return msgs;
}

/**
 * Filtros a los que suscribirse, **solo los de las superficies activadas**. Si un
 * toggle está apagado no se suscribe su filtro: el broker no tiene sujeto, así que
 * no suscribirse es la única garantía real de que esa acción no se puede invocar.
 */
export function commandFilters(prefix: string, control: ControlFlags): string[] {
  const filters: string[] = [];
  if (control.iot) {
    filters.push(`${prefix}/iot/+/set`, `${prefix}/iot/+/brightness/set`, `${prefix}/iot/+/rgb/set`);
  }
  if (control.pause) filters.push(`${prefix}/device/+/pause/set`);
  return filters;
}

/**
 * Comando entrante ya validado. Es una **unión discriminada** porque el namespace
 * dejó de ser solo `iot`: una pausa de internet no cabe en un `UpdateIotStateRequest`.
 */
export type InboundCommand =
  | { kind: 'iot'; deviceId: string; state: UpdateIotStateRequest }
  | { kind: 'pause'; deviceId: string; minutes: number };

/**
 * Parsea un comando entrante, o `null` si el topic/payload no es válido (defensivo:
 * un payload basura no debe lanzar). **No autoriza**: quien lo consume decide, y
 * solo llegan topics de filtros que se suscribieron por tener su toggle activo.
 */
export function parseInboundCommand(
  topic: string,
  payload: string,
  prefix: string,
): InboundCommand | null {
  const parts = topic.split('/');
  if (parts[0] !== prefix) return null;
  const deviceId = parts[2];
  if (!deviceId) return null;
  const rest = parts.slice(3).join('/');
  const body = payload.trim();

  if (parts[1] === 'device') {
    if (rest !== 'pause/set') return null;
    // El payload del botón de HA es el nº de minutos; vacío = el valor por defecto.
    const n = body === '' ? DEFAULT_PAUSE_MINUTES : Number(body);
    if (!Number.isFinite(n) || n <= 0) return null;
    return { kind: 'pause', deviceId, minutes: Math.min(MAX_PAUSE_MINUTES, Math.round(n)) };
  }

  if (parts[1] !== 'iot') return null;

  if (rest === 'set') {
    const v = body.toUpperCase();
    if (v === 'ON' || v === 'TRUE' || v === '1') return { kind: 'iot', deviceId, state: { on: true } };
    if (v === 'OFF' || v === 'FALSE' || v === '0') return { kind: 'iot', deviceId, state: { on: false } };
    return null;
  }
  if (rest === 'brightness/set') {
    const n = Number(body);
    if (!Number.isFinite(n)) return null;
    return { kind: 'iot', deviceId, state: { brightness: Math.max(0, Math.min(100, Math.round(n))) } };
  }
  if (rest === 'rgb/set') {
    const hex = rgbToHex(body);
    if (!hex) return null;
    return { kind: 'iot', deviceId, state: { color: { hex } } };
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
