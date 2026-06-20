import { describe, expect, it } from 'vitest';
import {
  buildLevelArgs,
  buildOnOffArgs,
  endpointForCluster,
  inferKind,
  levelToPercent,
  nodeToIotDevice,
  parseNodes,
  percentToLevel,
} from '../../src/iot/matter.parsers.js';

const LIGHT = {
  node_id: 4,
  available: true,
  attributes: { '1/6/0': true, '1/8/0': 254, '0/40/5': 'Lámpara salón' },
};
const PLUG = { node_id: 5, available: true, attributes: { '1/6/0': false, '0/40/3': 'Smart Plug' } };
const SENSOR = { node_id: 6, available: false, attributes: { '1/1026/0': 2150 } };

describe('escalado de nivel', () => {
  it('convierte 0-100 ↔ 0-254', () => {
    expect(percentToLevel(100)).toBe(254);
    expect(levelToPercent(127)).toBe(50);
  });
});

describe('parseNodes', () => {
  it('mapea nodos válidos y descarta sin node_id', () => {
    const nodes = parseNodes([LIGHT, { attributes: {} }]);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.node_id).toBe(4);
  });
});

describe('inferKind', () => {
  it('clasifica por clusters (LevelControl→light, OnOff→plug, resto→sensor)', () => {
    expect(inferKind(LIGHT.attributes)).toBe('light');
    expect(inferKind(PLUG.attributes)).toBe('plug');
    expect(inferKind(SENSOR.attributes)).toBe('sensor');
  });
});

describe('nodeToIotDevice', () => {
  it('mapea una luz con nombre, on y brillo', () => {
    expect(nodeToIotDevice(LIGHT)).toEqual({
      id: '4',
      name: 'Lámpara salón',
      kind: 'light',
      room: null,
      reachable: true,
      on: true,
      brightness: 100,
      color: null,
      reading: null,
    });
  });

  it('mapea un enchufe (sin brillo) y un sensor (lectura/100, reachable de available)', () => {
    expect(nodeToIotDevice(PLUG)).toMatchObject({ kind: 'plug', name: 'Smart Plug', on: false, brightness: null });
    expect(nodeToIotDevice(SENSOR)).toMatchObject({
      kind: 'sensor',
      reachable: false,
      on: null,
      reading: { metric: 'temperatura', value: 21.5, unit: '°C' },
    });
  });
});

describe('endpointForCluster + builders de device_command', () => {
  it('resuelve el endpoint del cluster y construye los args', () => {
    expect(endpointForCluster(LIGHT, 8)).toBe(1);
    expect(buildOnOffArgs(4, 1, true)).toEqual({
      node_id: 4,
      endpoint_id: 1,
      cluster_id: 6,
      command_name: 'On',
      payload: {},
    });
    expect(buildLevelArgs(4, 1, 127)).toEqual({
      node_id: 4,
      endpoint_id: 1,
      cluster_id: 8,
      command_name: 'MoveToLevel',
      payload: { level: 127, transitionTime: 0 },
    });
  });
});
