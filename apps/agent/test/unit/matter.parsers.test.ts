import { describe, expect, it } from 'vitest';
import {
  buildCoverOpenCloseArgs,
  buildCoverPositionArgs,
  buildLevelArgs,
  buildOnOffArgs,
  buildSetpointWriteArgs,
  endpointForCluster,
  inferKind,
  levelToPercent,
  luxFromMatter,
  nodeToIotDevice,
  parseNodes,
  percentToLevel,
  positionFromMatter,
  positionToMatter100ths,
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
      readings: [],
      // US-247: el mapeo pasa a llevar los tres campos de las categorías nuevas,
      // igual que zigbee2mqtt. En una luz son `null`, pero se declaran: un hueco
      // ausente y un hueco vacío se leen igual desde fuera y no lo son.
      position: null,
      targetC: null,
      locked: null,
    });
  });

  it('mapea un enchufe (sin brillo) y un sensor (lectura/100, reachable de available)', () => {
    expect(nodeToIotDevice(PLUG)).toMatchObject({ kind: 'plug', name: 'Smart Plug', on: false, brightness: null });
    expect(nodeToIotDevice(SENSOR)).toMatchObject({
      kind: 'sensor',
      reachable: false,
      on: null,
      readings: [{ metric: 'temperature', value: 21.5, unit: '°C' }],
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

/**
 * US-247 — las categorías que US-244 metió en el contrato y este backend ignoraba.
 * Antes de esta historia, un sensor de apertura, un detector de humo, una
 * persiana, un termostato y una cerradura Matter aterrizaban **todos** como
 * `sensor` (o `plug`, si exponían OnOff) y **sin una sola lectura**.
 */
describe('categorías nuevas en Matter (US-247)', () => {
  const CONTACTO = { node_id: 10, available: true, attributes: { '1/69/0': true, '0/40/5': 'Puerta' } };
  const HUMO = { node_id: 11, available: true, attributes: { '1/92/1': 0, '1/92/2': 0 } };
  const PERSIANA = { node_id: 12, available: true, attributes: { '1/258/8': 30, '1/6/0': true } };
  const TERMOSTATO = { node_id: 13, available: true, attributes: { '1/513/18': 2150, '1/513/0': 1980 } };
  const CERRADURA = { node_id: 14, available: true, attributes: { '1/257/0': 1, '1/6/0': false } };
  const PRESENCIA = { node_id: 15, available: true, attributes: { '1/1030/0': 1 } };

  it('clasifica cada categoría por su cluster', () => {
    expect(inferKind(CONTACTO.attributes)).toBe('contact');
    expect(inferKind(HUMO.attributes)).toBe('smoke');
    expect(inferKind(PERSIANA.attributes)).toBe('cover');
    expect(inferKind(TERMOSTATO.attributes)).toBe('climate');
    expect(inferKind(CERRADURA.attributes)).toBe('lock');
    // La presencia es una **lectura**, no una categoría: sigue siendo un sensor.
    expect(inferKind(PRESENCIA.attributes)).toBe('sensor');
  });

  it('⚠️ una persiana y una cerradura con OnOff NO son un enchufe', () => {
    // Las dos exponen OnOff además de su cluster propio. Con `plug` por delante
    // —que es como estaba— la UI les pintaba un interruptor y les mandaba On/Off.
    expect(inferKind(PERSIANA.attributes)).not.toBe('plug');
    expect(inferKind(CERRADURA.attributes)).not.toBe('plug');
    expect(nodeToIotDevice(PERSIANA).on).toBeNull();
    expect(nodeToIotDevice(CERRADURA).on).toBeNull();
  });

  it('⚠️ el contacto se INVIERTE: `true` en Matter es cerrado', () => {
    // Igual que en zigbee2mqtt. Sin invertir, la alarma saltaría al cerrar la
    // puerta y callaría al abrirla, sin un solo error por pantalla.
    expect(nodeToIotDevice(CONTACTO).readings).toEqual([{ metric: 'contact', value: 0, unit: '' }]);
    const abierta = { ...CONTACTO, attributes: { ...CONTACTO.attributes, '1/69/0': false } };
    expect(nodeToIotDevice(abierta).readings).toEqual([{ metric: 'contact', value: 1, unit: '' }]);
  });

  it('humo y CO: cualquier estado distinto de normal es una activación', () => {
    const aviso = { ...HUMO, attributes: { '1/92/1': 1, '1/92/2': 0 } };
    const critico = { ...HUMO, attributes: { '1/92/1': 2, '1/92/2': 0 } };
    expect(nodeToIotDevice(HUMO).readings).toEqual([
      { metric: 'smoke', value: 0, unit: '' },
      { metric: 'co', value: 0, unit: '' },
    ]);
    expect(nodeToIotDevice(aviso).readings[0]).toEqual({ metric: 'smoke', value: 1, unit: '' });
    // El crítico NO se pierde por no ser exactamente 1.
    expect(nodeToIotDevice(critico).readings[0]).toEqual({ metric: 'smoke', value: 1, unit: '' });
  });

  it('⚠️ la posición de la persiana se INVIERTE (Matter mide cierre)', () => {
    // 30 % de cierre en Matter = 70 % de apertura en el contrato. Sin invertir,
    // cerrar la persiana la enseñaría abierta y «abrir» la cerraría.
    expect(nodeToIotDevice(PERSIANA).position).toBe(70);
    expect(positionFromMatter(0)).toBe(100); // Matter 0 % cerrada = abierta del todo
    expect(positionToMatter100ths(100)).toBe(0);
    expect(positionToMatter100ths(70)).toBe(3000);
  });

  it('la posición también se lee del atributo en centésimas', () => {
    const p100 = { node_id: 16, available: true, attributes: { '1/258/14': 2500 } };
    expect(nodeToIotDevice(p100).position).toBe(75);
  });

  it('la consigna del termostato viene en centésimas de grado', () => {
    expect(nodeToIotDevice(TERMOSTATO).targetC).toBe(21.5);
    // Y la temperatura actual entra como lectura, no como consigna.
    expect(nodeToIotDevice(TERMOSTATO).readings).toContainEqual({
      metric: 'temperature',
      value: 19.8,
      unit: '°C',
    });
  });

  it('la cerradura a medias no se declara abierta', () => {
    expect(nodeToIotDevice(CERRADURA).locked).toBe(true);
    const abierta = { ...CERRADURA, attributes: { '1/257/0': 2 } };
    expect(nodeToIotDevice(abierta).locked).toBe(false);
    // 0 = «no del todo cerrada»: decir «abierta» sería peor que no decir nada.
    const aMedias = { ...CERRADURA, attributes: { '1/257/0': 0 } };
    expect(nodeToIotDevice(aMedias).locked).toBeNull();
  });

  it('⚠️ las lecturas ya NO se filtran por categoría', () => {
    // `readings: kind === 'sensor' ? readings : []` tiraba la batería de un
    // sensor de contacto y la temperatura de un termostato (US-244 lo cerró en
    // zigbee2mqtt y aquí seguía abierto).
    const conBateria = {
      node_id: 17,
      available: true,
      attributes: { '1/69/0': true, '0/47/12': 150 },
    };
    const dev = nodeToIotDevice(conBateria);
    expect(dev.kind).toBe('contact');
    // BatPercentRemaining va en MEDIOS por ciento: 150 → 75 %, no 150 %.
    expect(dev.readings).toContainEqual({ metric: 'battery', value: 75, unit: '%' });
  });

  it('⚠️ la luz ambiente de Matter es logarítmica, no lux', () => {
    // MeasuredValue = 10000·log10(lux)+1, así que 50 lux se publican como 16990.
    // Tomar ese número tal cual daría «16990 lux» en una habitación normal.
    expect(luxFromMatter(16990)).toBe(50);
    expect(luxFromMatter(30000)).toBe(1000);
    expect(luxFromMatter(1)).toBe(1);
    // 0 es el valor reservado de «desconocido»: no es oscuridad absoluta.
    expect(luxFromMatter(0)).toBeNull();
  });

  it('la presencia entra como lectura de ocupación (bitmap, bit 0)', () => {
    expect(nodeToIotDevice(PRESENCIA).readings).toEqual([{ metric: 'occupancy', value: 1, unit: '' }]);
    const vacio = { ...PRESENCIA, attributes: { '1/1030/0': 0 } };
    expect(nodeToIotDevice(vacio).readings).toEqual([{ metric: 'occupancy', value: 0, unit: '' }]);
  });

  it('los comandos de persiana y termostato', () => {
    expect(buildCoverPositionArgs(12, 1, 70)).toEqual({
      node_id: 12,
      endpoint_id: 1,
      cluster_id: 258,
      command_name: 'GoToLiftPercentage',
      payload: { liftPercent100thsValue: 3000 },
    });
    expect(buildCoverOpenCloseArgs(12, 1, true)).toMatchObject({ command_name: 'UpOrOpen' });
    expect(buildCoverOpenCloseArgs(12, 1, false)).toMatchObject({ command_name: 'DownOrClose' });
    // La consigna es un ATRIBUTO, no un comando: el cluster solo sabe subir/bajar
    // por incrementos y eso no sirve para «ponlo a 21».
    expect(buildSetpointWriteArgs(13, 1, 21.5)).toEqual({
      node_id: 13,
      attribute_path: '1/513/18',
      value: 2150,
    });
  });
});
