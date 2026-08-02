import type {
  IotDevice,
  IotDeviceKind,
  IotReading,
  MatterCommissionErrorCode,
} from '@krakenos/types';

/**
 * Parsers/builders **puros** para la API de python-matter-server. Mapean los
 * nodos Matter (atributos por `"<endpoint>/<cluster>/<attr>"`) a los tipos del
 * contrato y construyen los args de `device_command`, de modo que se testean
 * sin un servidor Matter real.
 */

/** IDs de cluster/atributo Matter usados en el mapeo. */
const ONOFF_CLUSTER = 6;
const LEVEL_CLUSTER = 8;
const TEMP_CLUSTER = 1026; // 0x0402 Temperature Measurement
const HUMIDITY_CLUSTER = 1029; // 0x0405 Relative Humidity
const BASIC_INFO_CLUSTER = 40; // 0x0028 Basic Information
const MEASURED_VALUE_ATTR = 0;
const NODE_LABEL_ATTR = 5;
const PRODUCT_NAME_ATTR = 3;

// Clusters de las categorías que US-244 añadió al contrato y que este backend
// ignoraba: un sensor de apertura, un detector de humo, una persiana, un
// termostato y una cerradura Matter aterrizaban todos como `sensor` sin una sola
// lectura (US-247).
export const BOOLEAN_STATE_CLUSTER = 69; // 0x0045 · sensores de contacto
export const OCCUPANCY_CLUSTER = 1030; // 0x0406 · presencia
export const SMOKE_CO_CLUSTER = 92; // 0x005C · detector de humo/CO
export const WINDOW_COVERING_CLUSTER = 258; // 0x0102 · persianas y toldos
export const THERMOSTAT_CLUSTER = 513; // 0x0201 · termostatos
export const DOOR_LOCK_CLUSTER = 257; // 0x0101 · cerraduras
export const ILLUMINANCE_CLUSTER = 1024; // 0x0400 · luz ambiente
export const POWER_SOURCE_CLUSTER = 47; // 0x002F · batería

const OCCUPANCY_ATTR = 0;
const SMOKE_STATE_ATTR = 1;
const CO_STATE_ATTR = 2;
/** CurrentPositionLiftPercentage (0x0008): 0-100, **0 = abierta** en Matter. */
const LIFT_PERCENTAGE_ATTR = 8;
/** CurrentPositionLiftPercent100ths (0x000E): 0-10000, misma orientación. */
const LIFT_PERCENT_100THS_ATTR = 14;
const OCCUPIED_HEATING_SETPOINT_ATTR = 18; // 0x0012, en centésimas de °C
const LOCAL_TEMPERATURE_ATTR = 0; // 0x0000 del Thermostat, en centésimas de °C
const LOCK_STATE_ATTR = 0;
const BAT_PERCENT_REMAINING_ATTR = 12; // 0x000C, en **medios** por ciento (0-200)

/** Nombre del atributo de consigna, para el `write_attribute` del termostato. */
export const HEATING_SETPOINT_PATH_ATTR = OCCUPIED_HEATING_SETPOINT_ATTR;

/** Nodo Matter tal como lo entrega `get_nodes`. */
export interface MatterNode {
  node_id: number;
  available?: boolean;
  attributes: Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

/** Brillo 0-100 (KrakenOS) → 0-254 (Matter LevelControl). */
export function percentToLevel(percent: number): number {
  return Math.round((Math.max(0, Math.min(100, percent)) / 100) * 254);
}

/** Nivel 0-254 (Matter) → 0-100 (KrakenOS). */
export function levelToPercent(level: number): number {
  return Math.round((Math.max(0, Math.min(254, level)) / 254) * 100);
}

/** Parsea el resultado de `get_nodes` a una lista de nodos. */
export function parseNodes(result: unknown): MatterNode[] {
  const list = Array.isArray(result) ? result : [];
  return list
    .map((raw): MatterNode | null => {
      const n = asRecord(raw);
      if (typeof n.node_id !== 'number') return null;
      return {
        node_id: n.node_id,
        available: n.available !== false,
        attributes: asRecord(n.attributes),
      };
    })
    .filter((n): n is MatterNode => n !== null);
}

/** Busca un atributo por (cluster, atributo) en cualquier endpoint. */
export function findAttribute(
  attributes: Record<string, unknown>,
  cluster: number,
  attribute: number,
): { endpoint: number; value: unknown } | null {
  for (const [key, value] of Object.entries(attributes)) {
    const m = /^(\d+)\/(\d+)\/(\d+)$/.exec(key);
    if (m && Number(m[2]) === cluster && Number(m[3]) === attribute) {
      return { endpoint: Number(m[1]), value };
    }
  }
  return null;
}

/**
 * Infiere la categoría KrakenOS a partir de los clusters presentes.
 *
 * ⚠️ **El orden importa y por el mismo motivo que en zigbee2mqtt** (US-244): una
 * persiana, una cerradura y muchos termostatos exponen **también** el cluster
 * OnOff, así que con `plug` por delante acababan clasificados como enchufe y la
 * UI les pintaba un interruptor. Las categorías específicas van primero; OnOff y
 * LevelControl son el fondo de saco, no la primera pregunta.
 */
export function inferKind(attributes: Record<string, unknown>): IotDeviceKind {
  if (findAttribute(attributes, DOOR_LOCK_CLUSTER, LOCK_STATE_ATTR)) return 'lock';
  if (
    findAttribute(attributes, WINDOW_COVERING_CLUSTER, LIFT_PERCENTAGE_ATTR) ||
    findAttribute(attributes, WINDOW_COVERING_CLUSTER, LIFT_PERCENT_100THS_ATTR)
  ) {
    return 'cover';
  }
  if (findAttribute(attributes, THERMOSTAT_CLUSTER, OCCUPIED_HEATING_SETPOINT_ATTR)) return 'climate';
  // Humo antes que contacto, igual que en z2m: un detector combinado es `smoke`.
  if (
    findAttribute(attributes, SMOKE_CO_CLUSTER, SMOKE_STATE_ATTR) ||
    findAttribute(attributes, SMOKE_CO_CLUSTER, CO_STATE_ATTR)
  ) {
    return 'smoke';
  }
  if (findAttribute(attributes, BOOLEAN_STATE_CLUSTER, MEASURED_VALUE_ATTR)) return 'contact';
  if (findAttribute(attributes, LEVEL_CLUSTER, 0)) return 'light';
  if (findAttribute(attributes, ONOFF_CLUSTER, 0)) return 'plug';
  return 'sensor';
}

/**
 * Lux a partir del `MeasuredValue` del cluster Illuminance.
 *
 * ⚠️ Matter **no** publica lux: publica `10000 × log10(lux) + 1`, así que tomar
 * el número tal cual daría ~47.000 «lux» para una habitación a 50 lux. `0` es el
 * valor reservado de «desconocido» y devuelve `null`.
 */
export function luxFromMatter(measured: number): number | null {
  if (!Number.isFinite(measured) || measured <= 0) return null;
  return Math.round(10 ** ((measured - 1) / 10000));
}

/**
 * Posición de persiana Matter → contrato KrakenOS.
 *
 * ⚠️ **Están invertidas.** En Matter el porcentaje es de *cierre* (0 = abierta
 * del todo); en KrakenOS `position` es de *apertura* (100 = abierta), como en
 * zigbee2mqtt. Sin invertir, cerrar la persiana la enseñaría abierta y la orden
 * de «abrir» la cerraría — sin un solo error por pantalla.
 */
export function positionFromMatter(liftPercentage: number): number {
  return Math.max(0, Math.min(100, 100 - liftPercentage));
}

/** Posición del contrato → `liftPercent100thsValue` de Matter (invertida). */
export function positionToMatter100ths(position: number): number {
  return Math.round((100 - Math.max(0, Math.min(100, position))) * 100);
}

/**
 * Endpoint donde vive un cluster (1 por defecto si no se encuentra).
 *
 * ⚠️ Busca **cualquier** atributo del cluster, no solo el `0`. Con la versión
 * anterior, una persiana que publica `CurrentPositionLiftPercentage` pero no el
 * atributo `Type` caía al endpoint 1 por defecto: si estaba en el 2, la orden se
 * mandaba al aparato equivocado del mismo nodo y no pasaba nada, sin error.
 */
export function endpointForCluster(node: MatterNode, cluster: number): number {
  for (const key of Object.keys(node.attributes)) {
    const m = /^(\d+)\/(\d+)\/(\d+)$/.exec(key);
    if (m && Number(m[2]) === cluster) return Number(m[1]);
  }
  return 1;
}

/** Mapea un nodo Matter a un `IotDevice`. */
export function nodeToIotDevice(node: MatterNode): IotDevice {
  const attrs = node.attributes;
  const kind = inferKind(attrs);
  const label = findAttribute(attrs, BASIC_INFO_CLUSTER, NODE_LABEL_ATTR)?.value;
  const product = findAttribute(attrs, BASIC_INFO_CLUSTER, PRODUCT_NAME_ATTR)?.value;
  const name =
    (typeof label === 'string' && label) ||
    (typeof product === 'string' && product) ||
    `Matter ${node.node_id}`;

  const onValue = findAttribute(attrs, ONOFF_CLUSTER, 0)?.value;
  const levelValue = findAttribute(attrs, LEVEL_CLUSTER, MEASURED_VALUE_ATTR)?.value;
  const temp = findAttribute(attrs, TEMP_CLUSTER, MEASURED_VALUE_ATTR)?.value;
  const humidity = findAttribute(attrs, HUMIDITY_CLUSTER, MEASURED_VALUE_ATTR)?.value;
  const illuminance = findAttribute(attrs, ILLUMINANCE_CLUSTER, MEASURED_VALUE_ATTR)?.value;
  const battery = findAttribute(attrs, POWER_SOURCE_CLUSTER, BAT_PERCENT_REMAINING_ATTR)?.value;
  const contact = findAttribute(attrs, BOOLEAN_STATE_CLUSTER, MEASURED_VALUE_ATTR)?.value;
  const occupancy = findAttribute(attrs, OCCUPANCY_CLUSTER, OCCUPANCY_ATTR)?.value;
  const smokeState = findAttribute(attrs, SMOKE_CO_CLUSTER, SMOKE_STATE_ATTR)?.value;
  const coState = findAttribute(attrs, SMOKE_CO_CLUSTER, CO_STATE_ATTR)?.value;

  // US-244: se acumulan TODAS las lecturas. Con el `else if` anterior, un nodo
  // que reporta temperatura y humedad perdía la humedad sin decirlo.
  const readings: IotReading[] = [];
  // ⚠️ Un termostato NO publica su temperatura en el cluster de medición: la
  // publica en `Thermostat/LocalTemperature`. Mirando solo el 1026 —como se
  // hacía— un termostato aparecía sin ninguna lectura, con su consigna al lado y
  // nada con lo que compararla.
  const localTemp = findAttribute(attrs, THERMOSTAT_CLUSTER, LOCAL_TEMPERATURE_ATTR)?.value;
  const temperatura = typeof temp === 'number' ? temp : typeof localTemp === 'number' ? localTemp : null;
  if (temperatura !== null) {
    readings.push({ metric: 'temperature', value: temperatura / 100, unit: '°C' });
  }
  if (typeof humidity === 'number') {
    readings.push({ metric: 'humidity', value: humidity / 100, unit: '%' });
  }
  if (typeof illuminance === 'number') {
    const lux = luxFromMatter(illuminance);
    if (lux !== null) readings.push({ metric: 'illuminance', value: lux, unit: 'lx' });
  }
  // BatPercentRemaining va en **medios** por ciento: 200 = 100 %. Sin dividir, un
  // sensor con la pila llena reportaría «200 %».
  if (typeof battery === 'number') {
    readings.push({ metric: 'battery', value: Math.round(battery / 2), unit: '%' });
  }
  // ⚠️ `StateValue` del cluster Boolean State: **true = cerrado** (hay contacto),
  // igual que el `contact` de zigbee2mqtt. Lo que la alarma tiene que ver como
  // «pasa algo» es la puerta ABIERTA, así que se invierte (US-244/US-245).
  if (typeof contact === 'boolean') {
    readings.push({ metric: 'contact', value: contact ? 0 : 1, unit: '' });
  }
  // Occupancy es un **bitmap**; el bit 0 es «ocupado».
  if (typeof occupancy === 'number') {
    readings.push({ metric: 'occupancy', value: occupancy & 1 ? 1 : 0, unit: '' });
  }
  // SmokeState/COState: 0 = normal, 1 = aviso, 2 = crítico. Cualquier valor
  // distinto de 0 es una activación: degradar el «crítico» a 1 no pierde nada
  // porque el contrato es binario, pero ignorar el 2 sería callar el peor caso.
  if (typeof smokeState === 'number') {
    readings.push({ metric: 'smoke', value: smokeState !== 0 ? 1 : 0, unit: '' });
  }
  if (typeof coState === 'number') {
    readings.push({ metric: 'co', value: coState !== 0 ? 1 : 0, unit: '' });
  }

  return {
    id: String(node.node_id),
    name,
    kind,
    room: null,
    reachable: node.available !== false,
    // Solo `light` y `plug` tienen encendido (mismo criterio que zigbee2mqtt): una
    // persiana o una cerradura exponen OnOff pero su estado vive en
    // `position`/`locked`, y darles `on` pinta un interruptor que no hace nada.
    on: kind === 'light' || kind === 'plug' ? (typeof onValue === 'boolean' ? onValue : null) : null,
    brightness: kind === 'light' && typeof levelValue === 'number' ? levelToPercent(levelValue) : null,
    // El color de Matter (cluster Color Control) no se mapea aún (baseline).
    color: null,
    // Las lecturas son del **aparato**, no de su categoría: filtrarlas por `kind`
    // —como se hacía— tiraba la batería de un sensor de contacto y la temperatura
    // de un termostato. Es el mismo fallo que US-244 cerró en zigbee2mqtt.
    readings,
    position: kind === 'cover' ? coverPosition(attrs) : null,
    targetC: kind === 'climate' ? heatingSetpoint(attrs) : null,
    locked: kind === 'lock' ? lockState(attrs) : null,
  };
}

/** Posición de una persiana (0 cerrada … 100 abierta) desde sus atributos. */
function coverPosition(attrs: Record<string, unknown>): number | null {
  const pct = findAttribute(attrs, WINDOW_COVERING_CLUSTER, LIFT_PERCENTAGE_ATTR)?.value;
  if (typeof pct === 'number') return positionFromMatter(pct);
  const pct100 = findAttribute(attrs, WINDOW_COVERING_CLUSTER, LIFT_PERCENT_100THS_ATTR)?.value;
  if (typeof pct100 === 'number') return positionFromMatter(pct100 / 100);
  return null;
}

/** Consigna de calefacción en °C (Matter la publica en centésimas). */
function heatingSetpoint(attrs: Record<string, unknown>): number | null {
  const raw = findAttribute(attrs, THERMOSTAT_CLUSTER, OCCUPIED_HEATING_SETPOINT_ATTR)?.value;
  return typeof raw === 'number' ? raw / 100 : null;
}

/**
 * ¿Está echada la cerradura? `LockState`: 0 = no del todo cerrada, 1 = cerrada,
 * 2 = abierta. El 0 **no** es «abierta»: es «no se sabe del todo», y decir que
 * está abierta cuando el pestillo está a medias sería peor que no decir nada.
 */
function lockState(attrs: Record<string, unknown>): boolean | null {
  const raw = findAttribute(attrs, DOOR_LOCK_CLUSTER, LOCK_STATE_ATTR)?.value;
  if (raw === 1) return true;
  if (raw === 2) return false;
  return null;
}

/** Args de `device_command` para encender/apagar (cluster OnOff). */
export function buildOnOffArgs(nodeId: number, endpoint: number, on: boolean): Record<string, unknown> {
  return {
    node_id: nodeId,
    endpoint_id: endpoint,
    cluster_id: ONOFF_CLUSTER,
    command_name: on ? 'On' : 'Off',
    payload: {},
  };
}

/** Args de `device_command` para fijar el brillo (cluster LevelControl). */
export function buildLevelArgs(nodeId: number, endpoint: number, level: number): Record<string, unknown> {
  return {
    node_id: nodeId,
    endpoint_id: endpoint,
    cluster_id: LEVEL_CLUSTER,
    command_name: 'MoveToLevel',
    payload: { level, transitionTime: 0 },
  };
}

/**
 * Args de `device_command` para mover una persiana (cluster Window Covering).
 * `position` es del contrato (100 = abierta) y se **invierte** al centésimo de
 * porcentaje de cierre que espera Matter.
 */
export function buildCoverPositionArgs(
  nodeId: number,
  endpoint: number,
  position: number,
): Record<string, unknown> {
  return {
    node_id: nodeId,
    endpoint_id: endpoint,
    cluster_id: WINDOW_COVERING_CLUSTER,
    command_name: 'GoToLiftPercentage',
    payload: { liftPercent100thsValue: positionToMatter100ths(position) },
  };
}

/** Args de `device_command` para abrir (`UpOrOpen`) o cerrar (`DownOrClose`). */
export function buildCoverOpenCloseArgs(
  nodeId: number,
  endpoint: number,
  open: boolean,
): Record<string, unknown> {
  return {
    node_id: nodeId,
    endpoint_id: endpoint,
    cluster_id: WINDOW_COVERING_CLUSTER,
    command_name: open ? 'UpOrOpen' : 'DownOrClose',
    payload: {},
  };
}

/**
 * Args de `write_attribute` para la consigna de un termostato.
 *
 * ⚠️ La consigna **no es un comando**, es un atributo: el cluster Thermostat solo
 * tiene `SetpointRaiseLower`, que mueve por **incrementos** relativos y no sirve
 * para «ponlo a 21». Por eso este camino usa `write_attribute` y no
 * `device_command` como el resto. La ruta va en centésimas de °C.
 */
export function buildSetpointWriteArgs(
  nodeId: number,
  endpoint: number,
  targetC: number,
): Record<string, unknown> {
  return {
    node_id: nodeId,
    attribute_path: `${endpoint}/${THERMOSTAT_CLUSTER}/${HEATING_SETPOINT_PATH_ATTR}`,
    value: Math.round(targetC * 100),
  };
}

// ---- Comisionado (US-172) ----

/**
 * Args del comando `commission_with_code` de python-matter-server: acepta tanto
 * el QR (`MT:…`) como el código manual de 11 dígitos. `network_only:false` permite
 * comisionar por BLE si hace falta (dispositivos aún no en la red).
 */
export function buildCommissionArgs(code: string): Record<string, unknown> {
  return { code: code.trim(), network_only: false };
}

/**
 * Extrae el `node_id` de la respuesta de `commission_with_code`. El resultado
 * puede ser el nodo (`{node_id}`) o venir envuelto; se buscan ambas formas.
 * Devuelve `null` si no se reconoce un id de nodo (el llamante lo trata como fallo).
 */
export function parseCommissionResult(result: unknown): { nodeId: number } | null {
  const r = (result ?? {}) as Record<string, unknown>;
  const raw = r.node_id ?? (r.node as Record<string, unknown> | undefined)?.node_id;
  const nodeId = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(nodeId) ? { nodeId } : null;
}

/**
 * Clasifica un fallo de comisionado en un código estable para traducir a un
 * mensaje amable en la UI (US-172). Se basa en palabras clave del mensaje del
 * controlador (heurístico, tolerante a mayúsculas/idioma del server).
 */
export function classifyCommissionError(message: string): MatterCommissionErrorCode {
  const m = message.toLowerCase();
  if (/(invalid|parse|malformed|qr|code)/.test(m)) return 'invalid-code';
  if (/(thread|border router|no operational dataset)/.test(m)) return 'thread-no-border';
  if (/(timeout|unreachable|not found|no response|discover)/.test(m)) return 'not-found';
  return 'failed';
}
