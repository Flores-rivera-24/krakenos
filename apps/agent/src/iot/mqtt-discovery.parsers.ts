import type { IotDeviceKind, IotMetric, IotReading } from '@krakenos/types';

/**
 * Parsers **puros** de MQTT Discovery entrante (US-248).
 *
 * Es la contraparte de `modules/interop/ha-discovery.ts`, que **produce** esta
 * misma convención: aquí se **consume**. Lo que entra son mensajes retenidos que
 * publica el propio aparato (ESPHome, Tasmota, OpenBeken, Z-Wave JS UI,
 * zigbee2mqtt), no Home Assistant: HA es otro **consumidor** de este namespace, no
 * su fuente. Esa distinción es la decisión del ADR `adr-ingesta-mqtt.md` y aquí se
 * sostiene sola, porque nada de este fichero sabe que HA existe.
 *
 * Todo lo de aquí es puro: entra texto de un topic y un payload, sale una
 * estructura. La conexión, la caché y la publicación viven en
 * `mqtt-discovery.iot.ts`.
 */

/** Prefijo de discovery por convención (configurable). */
export const DEFAULT_DISCOVERY_PREFIX = 'homeassistant';

/**
 * Abreviaturas del formato. **No es un detalle cosmético**: ESPHome publica las
 * claves completas y **Tasmota publica solo abreviadas** (`stat_t`, `val_tpl`,
 * `dev`), así que sin esta tabla uno de los cinco emisores que la historia nombra
 * no produciría ni un dispositivo. Solo se traducen las claves que se consumen:
 * una abreviatura desconocida se deja como está y se ignora aguas abajo.
 */
const ABREVIATURAS: Record<string, string> = {
  avty: 'availability',
  avty_t: 'availability_topic',
  bri_cmd_t: 'brightness_command_topic',
  bri_scl: 'brightness_scale',
  bri_stat_t: 'brightness_state_topic',
  bri_val_tpl: 'brightness_value_template',
  cmd_t: 'command_topic',
  curr_temp_t: 'current_temperature_topic',
  dev: 'device',
  dev_cla: 'device_class',
  ids: 'identifiers',
  mdl: 'model',
  mf: 'manufacturer',
  name: 'name',
  obj_id: 'object_id',
  pl_avail: 'payload_available',
  pl_cls: 'payload_close',
  pl_not_avail: 'payload_not_available',
  pl_off: 'payload_off',
  pl_on: 'payload_on',
  pl_open: 'payload_open',
  pos_clsd: 'position_closed',
  pos_open: 'position_open',
  pos_t: 'position_topic',
  set_pos_t: 'set_position_topic',
  stat_cla: 'state_class',
  stat_t: 'state_topic',
  stat_val_tpl: 'state_value_template',
  temp_cmd_t: 'temperature_command_topic',
  temp_stat_t: 'temperature_state_topic',
  unit_of_meas: 'unit_of_measurement',
  uniq_id: 'unique_id',
  val_tpl: 'value_template',
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

/**
 * Expande abreviaturas y el **topic base `~`**. Tasmota manda
 * `{"~":"tasmota_ABC/","stat_t":"~STATE","cmd_t":"~cmnd/POWER"}`: sin resolver el
 * `~`, los topics resultantes no existen y el aparato se queda mudo para siempre
 * sin un solo error. La sustitución es solo al **principio o al final** del valor,
 * como manda la convención — no un reemplazo global, que rompería un topic que
 * contenga `~` en medio.
 */
export function expandirConfig(raw: unknown): Record<string, unknown> {
  const entrada = asRecord(raw);
  const base = str(entrada['~']) ?? '';
  const salida: Record<string, unknown> = {};
  for (const [clave, valor] of Object.entries(entrada)) {
    if (clave === '~') continue;
    const nombre = ABREVIATURAS[clave] ?? clave;
    salida[nombre] = nombre === 'device' ? expandirDevice(valor) : expandirTopic(nombre, valor, base);
  }
  return salida;
}

/** El bloque `device` trae sus propias abreviaturas (`ids`, `mf`, `mdl`). */
function expandirDevice(valor: unknown): Record<string, unknown> {
  const dev = asRecord(valor);
  const salida: Record<string, unknown> = {};
  for (const [clave, v] of Object.entries(dev)) salida[ABREVIATURAS[clave] ?? clave] = v;
  return salida;
}

/** Sustituye `~` por el topic base, solo en las claves que son topics. */
function expandirTopic(nombre: string, valor: unknown, base: string): unknown {
  if (base === '') return valor;
  if (nombre === 'availability' && Array.isArray(valor)) {
    return valor.map((item) => {
      const rec = expandirDevice(item); // reutiliza el expansor de claves cortas
      const t = str(rec.topic);
      if (t) rec.topic = sustituirTilde(t, base);
      return rec;
    });
  }
  if (!nombre.endsWith('topic') || typeof valor !== 'string') return valor;
  return sustituirTilde(valor, base);
}

function sustituirTilde(valor: string, base: string): string {
  if (valor.startsWith('~')) return base + valor.slice(1);
  if (valor.endsWith('~')) return valor.slice(0, -1) + base;
  return valor;
}

/** Partes de un topic de config `<prefijo>/<componente>/[<nodo>/]<objeto>/config`. */
export interface TopicDeConfig {
  component: string;
  nodeId: string | null;
  objectId: string;
}

/** Parsea un topic de config, o `null` si no lo es (defensivo: no lanza). */
export function parseDiscoveryTopic(topic: string, prefix: string): TopicDeConfig | null {
  const partes = topic.split('/');
  if (partes[0] !== prefix) return null;
  if (partes[partes.length - 1] !== 'config') return null;
  if (partes.length === 4) {
    const [, component, objectId] = partes;
    return component && objectId ? { component, nodeId: null, objectId } : null;
  }
  if (partes.length === 5) {
    const [, component, nodeId, objectId] = partes;
    return component && nodeId && objectId ? { component, nodeId, objectId } : null;
  }
  return null;
}

/**
 * Plantilla de valor. Se modela como **datos, no como una función**, para poder
 * inspeccionarla, testearla y —sobre todo— para que quede explícito que nunca se
 * *evalúa* nada que venga del broker.
 *
 * `no-soportada` no es un fallo silencioso: el aparato se sigue listando y su
 * lectura queda vacía, que es la verdad. Interpretar Jinja2 de verdad significaría
 * ejecutar código de terceros llegado por la red, y esa es una superficie que este
 * proyecto no abre (`adr-ingesta-mqtt.md` §«La plantilla que no se ejecuta»).
 */
export type PlantillaValor =
  | { tipo: 'directa' }
  | { tipo: 'ruta'; ruta: string[] }
  | { tipo: 'no-soportada'; fuente: string };

/** Formas de plantilla que sí se entienden: `{{ value }}` y `{{ value_json.a['b'] }}`. */
const RE_VALUE = /^\{\{\s*value\s*\}\}$/;
const RE_VALUE_JSON = /^\{\{\s*value_json((?:\.[A-Za-z_$][\w$]*|\[\s*'[^']*'\s*\]|\[\s*"[^"]*"\s*\])*)\s*\}\}$/;
const RE_SEGMENTO = /\.([A-Za-z_$][\w$]*)|\[\s*'([^']*)'\s*\]|\[\s*"([^"]*)"\s*\]/g;

/** Compila una plantilla al subconjunto soportado. Sin plantilla → `directa`. */
export function compilarPlantilla(tpl: string | null): PlantillaValor {
  if (tpl === null) return { tipo: 'directa' };
  const fuente = tpl.trim();
  if (RE_VALUE.test(fuente)) return { tipo: 'directa' };
  const m = RE_VALUE_JSON.exec(fuente);
  if (!m) return { tipo: 'no-soportada', fuente };
  const ruta: string[] = [];
  for (const seg of (m[1] ?? '').matchAll(RE_SEGMENTO)) {
    const clave = seg[1] ?? seg[2] ?? seg[3];
    if (clave !== undefined) ruta.push(clave);
  }
  // `{{ value_json }}` a secas no identifica ningún valor concreto.
  return ruta.length > 0 ? { tipo: 'ruta', ruta } : { tipo: 'no-soportada', fuente };
}

/**
 * Un paso de la ruta, **solo sobre propiedades propias**.
 *
 * ⚠️ La ruta la escribe quien publica en el broker. Sin el `hasOwnProperty`,
 * `{{ value_json.constructor }}` o `{{ value_json.__proto__ }}` recorrerían la
 * cadena de prototipos y devolverían como «lectura del sensor» algo que no está en
 * el mensaje. Va en su propia función y no dentro del bucle a propósito: el acceso
 * dinámico queda pegado a su guarda, que es lo que hace el patrón seguro de leer.
 */
function propiedadPropia(objeto: unknown, clave: string): unknown {
  if (!objeto || typeof objeto !== 'object') return undefined;
  if (!Object.prototype.hasOwnProperty.call(objeto, clave)) return undefined;
  return (objeto as Record<string, unknown>)[clave];
}

/** Extrae el valor de un payload según la plantilla. `null` = no hay dato. */
export function extraerValor(plantilla: PlantillaValor, payload: string): string | null {
  if (plantilla.tipo === 'no-soportada') return null;
  if (plantilla.tipo === 'directa') return payload;
  let actual: unknown;
  try {
    actual = JSON.parse(payload);
  } catch {
    return null;
  }
  for (const clave of plantilla.ruta) {
    actual = propiedadPropia(actual, clave);
    if (actual === undefined) return null;
  }
  if (actual === null || actual === undefined) return null;
  if (typeof actual === 'object') return null;
  return String(actual);
}

/** Regla de disponibilidad declarada por el aparato. */
export interface ReglaDisponibilidad {
  topic: string;
  online: string;
  offline: string;
}

/** Una entidad de discovery ya normalizada. */
export interface EntidadDescubierta {
  /** Topic de config del que salió: es su identidad para altas y bajas. */
  configTopic: string;
  component: string;
  objectId: string;
  uniqueId: string | null;
  name: string;
  /** Clave de agrupación: varias entidades del mismo aparato comparten `IotDevice`. */
  deviceKey: string;
  deviceName: string;
  stateTopic: string | null;
  plantilla: PlantillaValor;
  commandTopic: string | null;
  payloadOn: string;
  payloadOff: string;
  deviceClass: string | null;
  unit: string | null;
  availability: ReglaDisponibilidad[];
  brightnessStateTopic: string | null;
  brightnessPlantilla: PlantillaValor;
  brightnessCommandTopic: string | null;
  brightnessScale: number;
  positionTopic: string | null;
  setPositionTopic: string | null;
  positionOpen: number;
  positionClosed: number;
  payloadOpen: string;
  payloadClose: string;
  temperatureStateTopic: string | null;
  temperatureCommandTopic: string | null;
  currentTemperatureTopic: string | null;
}

/**
 * Sanea el identificador que el aparato declara para poder usarlo como **id
 * persistido**. La barra es la que importa: el id viaja en `/api/iot/devices/:id`
 * y un `/` partiría la ruta; los comodines MQTT y los espacios se quitan por la
 * misma razón que en el publicador (`encodeTopic`).
 */
export function saneaId(bruto: string): string {
  return bruto.replace(/[/+#\s]/g, '_');
}

/** Componentes de HA que este contrato sabe representar (US-244). El resto se ignora. */
export const COMPONENTES_SOPORTADOS = [
  'light',
  'switch',
  'cover',
  'climate',
  'lock',
  'binary_sensor',
  'sensor',
] as const;

/**
 * ¿Es nuestra esta config? El publicador de US-213 escribe en
 * `homeassistant/<componente>/krakenos/<objeto>/config` sobre **el mismo broker**
 * que este consumidor puede estar escuchando.
 *
 * ⚠️ Sin este filtro, KrakenOS se ingiere a sí mismo: cada aparato aparecería dos
 * veces (una real y otra «mqtt:…»), el histórico de energía se contaría por
 * duplicado y —lo peor— encender la copia publicaría en nuestro propio
 * `command_topic`, cerrando un **bucle de órdenes** con el anti-bucle de
 * automatizaciones fuera de juego, porque para el motor sería un aparato distinto.
 */
export function esNuestraPropiaConfig(topic: TopicDeConfig, config: Record<string, unknown>): boolean {
  if (topic.nodeId === 'krakenos') return true;
  const uniqueId = str(config.unique_id);
  if (uniqueId?.startsWith('krakenos_')) return true;
  const ids = asRecord(config.device).identifiers;
  const lista = Array.isArray(ids) ? ids : typeof ids === 'string' ? [ids] : [];
  return lista.some((id) => typeof id === 'string' && id.startsWith('krakenos_'));
}

/** Lee `availability_topic` (simple) o `availability` (lista) a una forma única. */
function parseDisponibilidad(config: Record<string, unknown>): ReglaDisponibilidad[] {
  const online = str(config.payload_available) ?? 'online';
  const offline = str(config.payload_not_available) ?? 'offline';
  const reglas: ReglaDisponibilidad[] = [];
  const simple = str(config.availability_topic);
  if (simple) reglas.push({ topic: simple, online, offline });
  const lista = config.availability;
  if (Array.isArray(lista)) {
    for (const item of lista) {
      const rec = asRecord(item);
      const topic = str(rec.topic);
      if (!topic) continue;
      reglas.push({
        topic,
        online: str(rec.payload_available) ?? online,
        offline: str(rec.payload_not_available) ?? offline,
      });
    }
  }
  return reglas;
}

/**
 * Normaliza una config de discovery. `null` si el componente no encaja en el
 * contrato, si es nuestra propia publicación o si el payload no es un objeto.
 */
export function parseDiscoveryConfig(
  topic: TopicDeConfig,
  raw: unknown,
): EntidadDescubierta | null {
  const config = expandirConfig(raw);
  if (Object.keys(config).length === 0) return null;
  if (!(COMPONENTES_SOPORTADOS as readonly string[]).includes(topic.component)) return null;
  if (esNuestraPropiaConfig(topic, config)) return null;

  const device = asRecord(config.device);
  const ids = device.identifiers;
  const identificador = Array.isArray(ids)
    ? ids.find((v): v is string => typeof v === 'string' && v !== '')
    : str(ids);
  const uniqueId = str(config.unique_id);
  const name = str(config.name) ?? topic.objectId;

  // Agrupación: varias entidades del mismo aparato (el relé + su sensor de
  // potencia + su batería) tienen que colapsar en UN `IotDevice` con sus
  // `readings[]`, que es justo para lo que US-244 convirtió las lecturas en lista.
  // Sin agrupar, un enchufe Tasmota aparecería como tres aparatos sueltos.
  const deviceKey = saneaId(identificador ?? uniqueId ?? `${topic.component}/${topic.objectId}`);

  return {
    configTopic: '', // lo rellena quien conoce el topic completo
    component: topic.component,
    objectId: topic.objectId,
    uniqueId,
    name,
    deviceKey,
    deviceName: str(device.name) ?? name,
    stateTopic: str(config.state_topic),
    plantilla: compilarPlantilla(str(config.state_value_template) ?? str(config.value_template)),
    commandTopic: str(config.command_topic),
    payloadOn: str(config.payload_on) ?? 'ON',
    payloadOff: str(config.payload_off) ?? 'OFF',
    deviceClass: str(config.device_class),
    unit: str(config.unit_of_measurement),
    availability: parseDisponibilidad(config),
    brightnessStateTopic: str(config.brightness_state_topic),
    brightnessPlantilla: compilarPlantilla(str(config.brightness_value_template)),
    brightnessCommandTopic: str(config.brightness_command_topic),
    brightnessScale: num(config.brightness_scale) ?? 255,
    positionTopic: str(config.position_topic),
    setPositionTopic: str(config.set_position_topic),
    positionOpen: num(config.position_open) ?? 100,
    positionClosed: num(config.position_closed) ?? 0,
    payloadOpen: str(config.payload_open) ?? 'OPEN',
    payloadClose: str(config.payload_close) ?? 'CLOSE',
    temperatureStateTopic: str(config.temperature_state_topic),
    temperatureCommandTopic: str(config.temperature_command_topic),
    currentTemperatureTopic: str(config.current_temperature_topic),
  };
}

/**
 * Categoría del aparato a partir de los componentes de sus entidades.
 *
 * ⚠️ **El orden es la lección de US-244 otra vez**: las categorías específicas van
 * ANTES que `switch`. Un enchufe Tasmota con medidor tiene `switch` + `sensor`, y
 * una persiana tiene `cover` + `sensor`; resolver por «lo primero que aparezca»
 * pintaría un interruptor a una persiana y le mandaría `ON`, que no significa nada
 * para ella.
 */
export function categoriaDeEntidades(entidades: EntidadDescubierta[]): IotDeviceKind {
  const componentes = new Set(entidades.map((e) => e.component));
  const clasesBinarias = new Set(
    entidades.filter((e) => e.component === 'binary_sensor').map((e) => e.deviceClass ?? ''),
  );
  if (componentes.has('light')) return 'light';
  if (componentes.has('lock')) return 'lock';
  if (componentes.has('cover')) return 'cover';
  if (componentes.has('climate')) return 'climate';
  // Humo antes que contacto: un detector combinado (humo + tamper) es un `smoke`.
  if ([...clasesBinarias].some((c) => c === 'smoke' || c === 'gas' || c === 'carbon_monoxide')) {
    return 'smoke';
  }
  if ([...clasesBinarias].some((c) => CLASES_DE_CONTACTO.has(c))) return 'contact';
  if (componentes.has('switch')) return 'plug';
  return 'sensor';
}

const CLASES_DE_CONTACTO = new Set(['door', 'window', 'opening', 'garage_door']);

/** `device_class` de un `sensor` → métrica del contrato (US-244), o `null`. */
const METRICA_POR_CLASE: Record<string, IotMetric> = {
  temperature: 'temperature',
  humidity: 'humidity',
  power: 'power',
  energy: 'energy',
  battery: 'battery',
  illuminance: 'illuminance',
};

/**
 * Unidad → métrica, **solo cuando no hay `device_class`**. Tasmota publica muchos
 * sensores sin clase pero con unidad. `%` a secas queda fuera a propósito: puede
 * ser humedad o batería y adivinarlo sería inventarse el dato.
 */
const METRICA_POR_UNIDAD: Record<string, IotMetric> = {
  '°C': 'temperature',
  '°F': 'temperature',
  W: 'power',
  kW: 'power',
  Wh: 'energy',
  kWh: 'energy',
  lx: 'illuminance',
  lux: 'illuminance',
};

/** Métrica de un `sensor`, por clase y —si falta— por unidad. `null` = no mapea. */
export function metricaDeSensor(deviceClass: string | null, unit: string | null): IotMetric | null {
  if (deviceClass && METRICA_POR_CLASE[deviceClass]) return METRICA_POR_CLASE[deviceClass];
  if (deviceClass) return null;
  return unit ? (METRICA_POR_UNIDAD[unit] ?? null) : null;
}

/**
 * Métrica de un `binary_sensor` por su `device_class`.
 *
 * ⚠️ **Aquí NO se invierte, y en zigbee2mqtt sí.** En esta convención `ON` de un
 * `binary_sensor` con clase `door` significa **abierto**; en z2m, `contact: true`
 * significa **cerrado** (US-244). Es el mismo sensor físico con la polaridad
 * opuesta según el protocolo, así que copiar el mapeo del otro backend haría que
 * la alarma saltara al cerrar la puerta y callara al abrirla, sin ningún error.
 */
export function metricaDeBinario(deviceClass: string | null): IotMetric | null {
  if (!deviceClass) return null;
  if (deviceClass === 'smoke' || deviceClass === 'gas') return 'smoke';
  if (deviceClass === 'carbon_monoxide') return 'co';
  if (CLASES_DE_CONTACTO.has(deviceClass)) return 'contact';
  if (deviceClass === 'motion' || deviceClass === 'occupancy' || deviceClass === 'presence') {
    return 'occupancy';
  }
  return null;
}

/** Convierte una lectura cruda de sensor en `IotReading`, o `null` si no aplica. */
export function lecturaDeSensor(entidad: EntidadDescubierta, valor: string): IotReading | null {
  const metric = metricaDeSensor(entidad.deviceClass, entidad.unit);
  if (!metric) return null;
  const n = Number(valor);
  if (!Number.isFinite(n)) return null;
  return { metric, value: n, unit: entidad.unit ?? '' };
}

/** Convierte el estado de un binario en `IotReading` (1 = activo), o `null`. */
export function lecturaDeBinario(entidad: EntidadDescubierta, valor: string): IotReading | null {
  const metric = metricaDeBinario(entidad.deviceClass);
  if (!metric) return null;
  const activo = valor === entidad.payloadOn;
  const inactivo = valor === entidad.payloadOff;
  if (!activo && !inactivo) return null;
  return { metric, value: activo ? 1 : 0, unit: '' };
}

/**
 * Potencia y energía en las unidades del contrato (US-181): `powerW` en vatios y
 * `energyWh` en vatios-hora. Un enchufe ESPHome publica kWh y otro Wh; sumarlos
 * sin mirar la unidad daría una factura mil veces mayor.
 */
export function normalizarEnergia(reading: IotReading): { powerW?: number; energyWh?: number } {
  if (reading.metric === 'power') {
    return { powerW: reading.unit === 'kW' ? reading.value * 1000 : reading.value };
  }
  if (reading.metric === 'energy') {
    return { energyWh: reading.unit === 'kWh' ? reading.value * 1000 : reading.value };
  }
  return {};
}

/** Brillo 0-100 (KrakenOS) → escala del aparato (por defecto 0-255). */
export function brilloAEscala(percent: number, escala: number): number {
  return Math.round((Math.max(0, Math.min(100, percent)) / 100) * escala);
}

/** Brillo en la escala del aparato → 0-100 (KrakenOS). */
export function brilloDesdeEscala(valor: number, escala: number): number {
  if (escala <= 0) return 0;
  return Math.round((Math.max(0, Math.min(escala, valor)) / escala) * 100);
}

/** Un mensaje a publicar para aplicar un cambio de estado. */
export interface MensajeDeOrden {
  topic: string;
  payload: string;
}

/**
 * Construye las órdenes MQTT de un cambio de estado. Devuelve `[]` cuando el
 * aparato **no declara** el topic necesario: publicar en un topic inventado sería
 * mandar una orden al vacío y responder «hecho».
 *
 * ⚠️ `lock` no aparece aquí, y no es un olvido: no está en `CONTROLLABLE_IOT_KINDS`
 * (US-244) y abrir la puerta de la calle por API es la decisión de **US-246**.
 */
export function construirOrdenes(
  entidades: EntidadDescubierta[],
  kind: IotDeviceKind,
  input: { on?: boolean; brightness?: number; position?: number; targetC?: number },
): MensajeDeOrden[] {
  const de = (component: string) => entidades.find((e) => e.component === component);
  const mensajes: MensajeDeOrden[] = [];

  if (kind === 'cover') {
    const cover = de('cover');
    if (!cover) return [];
    if (input.position !== undefined && cover.setPositionTopic) {
      const rango = cover.positionOpen - cover.positionClosed;
      const valor = cover.positionClosed + (Math.max(0, Math.min(100, input.position)) / 100) * rango;
      mensajes.push({ topic: cover.setPositionTopic, payload: String(Math.round(valor)) });
    } else if (input.on !== undefined && cover.commandTopic) {
      mensajes.push({
        topic: cover.commandTopic,
        payload: input.on ? cover.payloadOpen : cover.payloadClose,
      });
    }
    return mensajes;
  }

  if (kind === 'climate') {
    const climate = de('climate');
    if (climate?.temperatureCommandTopic && input.targetC !== undefined) {
      mensajes.push({ topic: climate.temperatureCommandTopic, payload: String(input.targetC) });
    }
    return mensajes;
  }

  const principal = de('light') ?? de('switch');
  if (!principal) return [];
  if (input.on !== undefined && principal.commandTopic) {
    mensajes.push({
      topic: principal.commandTopic,
      payload: input.on ? principal.payloadOn : principal.payloadOff,
    });
  }
  if (input.brightness !== undefined && principal.brightnessCommandTopic) {
    mensajes.push({
      topic: principal.brightnessCommandTopic,
      payload: String(brilloAEscala(input.brightness, principal.brightnessScale)),
    });
    // Subir el brillo enciende, igual que en zigbee2mqtt: si no, la luz se queda
    // apagada «con un brillo nuevo» y el usuario cree que la orden se perdió.
    if (input.on === undefined && principal.commandTopic) {
      mensajes.push({
        topic: principal.commandTopic,
        payload: input.brightness > 0 ? principal.payloadOn : principal.payloadOff,
      });
    }
  }
  return mensajes;
}
