import type { IotDevice, IotDeviceKind, IotReading } from '@krakenos/types';

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

/** Infiere la categoría KrakenOS a partir de los clusters presentes. */
export function inferKind(attributes: Record<string, unknown>): IotDeviceKind {
  if (findAttribute(attributes, LEVEL_CLUSTER, 0)) return 'light';
  if (findAttribute(attributes, ONOFF_CLUSTER, 0)) return 'plug';
  return 'sensor';
}

/** Endpoint donde vive un cluster (1 por defecto si no se encuentra). */
export function endpointForCluster(node: MatterNode, cluster: number): number {
  return findAttribute(node.attributes, cluster, 0)?.endpoint ?? 1;
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

  let reading: IotReading | null = null;
  if (typeof temp === 'number') reading = { metric: 'temperatura', value: temp / 100, unit: '°C' };
  else if (typeof humidity === 'number') reading = { metric: 'humedad', value: humidity / 100, unit: '%' };

  return {
    id: String(node.node_id),
    name,
    kind,
    room: null,
    reachable: node.available !== false,
    on: kind === 'sensor' ? null : typeof onValue === 'boolean' ? onValue : null,
    brightness: kind === 'light' && typeof levelValue === 'number' ? levelToPercent(levelValue) : null,
    reading: kind === 'sensor' ? reading : null,
  };
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
