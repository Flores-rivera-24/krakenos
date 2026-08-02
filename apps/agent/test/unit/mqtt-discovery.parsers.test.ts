import { describe, expect, it } from 'vitest';
import {
  categoriaDeEntidades,
  compilarPlantilla,
  construirOrdenes,
  esNuestraPropiaConfig,
  expandirConfig,
  extraerValor,
  lecturaDeBinario,
  lecturaDeSensor,
  metricaDeBinario,
  metricaDeSensor,
  normalizarEnergia,
  parseDiscoveryConfig,
  parseDiscoveryTopic,
  saneaId,
  type EntidadDescubierta,
} from '../../src/iot/mqtt-discovery.parsers.js';
import { parseDeviceState } from '../../src/iot/zigbee2mqtt.parsers.js';

/**
 * US-248 — parsers de la ingesta genérica por MQTT Discovery.
 */

/** Config mínima de una entidad, para tests de agrupación/órdenes. */
function entidad(over: Partial<EntidadDescubierta>): EntidadDescubierta {
  return {
    configTopic: 't',
    component: 'switch',
    objectId: 'obj',
    uniqueId: 'uid',
    name: 'Entidad',
    deviceKey: 'dev',
    deviceName: 'Aparato',
    stateTopic: null,
    plantilla: { tipo: 'directa' },
    commandTopic: null,
    payloadOn: 'ON',
    payloadOff: 'OFF',
    deviceClass: null,
    unit: null,
    availability: [],
    brightnessStateTopic: null,
    brightnessPlantilla: { tipo: 'directa' },
    brightnessCommandTopic: null,
    brightnessScale: 255,
    positionTopic: null,
    setPositionTopic: null,
    positionOpen: 100,
    positionClosed: 0,
    payloadOpen: 'OPEN',
    payloadClose: 'CLOSE',
    temperatureStateTopic: null,
    temperatureCommandTopic: null,
    currentTemperatureTopic: null,
    ...over,
  };
}

describe('parseDiscoveryTopic', () => {
  it('acepta la forma con y sin nodo', () => {
    expect(parseDiscoveryTopic('homeassistant/switch/relay1/config', 'homeassistant')).toEqual({
      component: 'switch',
      nodeId: null,
      objectId: 'relay1',
    });
    expect(parseDiscoveryTopic('homeassistant/sensor/salon/temp/config', 'homeassistant')).toEqual({
      component: 'sensor',
      nodeId: 'salon',
      objectId: 'temp',
    });
  });

  it('ignora lo que no es una config o va en otro prefijo', () => {
    // `homeassistant/status` es el birth/will de un consumidor: llega por el mismo
    // comodín `#` y no debe interpretarse como un aparato.
    expect(parseDiscoveryTopic('homeassistant/status', 'homeassistant')).toBeNull();
    expect(parseDiscoveryTopic('homeassistant/switch/relay1/state', 'homeassistant')).toBeNull();
    expect(parseDiscoveryTopic('otro/switch/relay1/config', 'homeassistant')).toBeNull();
    expect(parseDiscoveryTopic('homeassistant/a/b/c/d/config', 'homeassistant')).toBeNull();
  });
});

describe('expandirConfig', () => {
  it('traduce las abreviaturas que publica Tasmota', () => {
    // Sin esto, uno de los cinco emisores que la historia nombra no produciría ni
    // un dispositivo: Tasmota publica SOLO claves cortas.
    const out = expandirConfig({
      name: 'Enchufe',
      stat_t: 'tele/x/STATE',
      cmd_t: 'cmnd/x/POWER',
      val_tpl: '{{value_json.POWER}}',
      pl_on: 'ON',
      uniq_id: 'x_RL_1',
      dev_cla: 'outlet',
      dev: { ids: ['ABC'], mf: 'Tasmota', mdl: 'Sonoff' },
    });
    expect(out.state_topic).toBe('tele/x/STATE');
    expect(out.command_topic).toBe('cmnd/x/POWER');
    expect(out.value_template).toBe('{{value_json.POWER}}');
    expect(out.unique_id).toBe('x_RL_1');
    expect(out.device_class).toBe('outlet');
    expect(out.device).toEqual({ identifiers: ['ABC'], manufacturer: 'Tasmota', model: 'Sonoff' });
  });

  it('resuelve el topic base `~` al principio y al final', () => {
    const out = expandirConfig({
      '~': 'tasmota_ABC/',
      stat_t: '~STATE',
      cmd_t: '~cmnd/POWER',
      avty_t: 'tele/x/LWT',
    });
    expect(out.state_topic).toBe('tasmota_ABC/STATE');
    expect(out.command_topic).toBe('tasmota_ABC/cmnd/POWER');
    expect(out.availability_topic).toBe('tele/x/LWT'); // sin `~`: intacto
    const sufijo = expandirConfig({ '~': '/sufijo', stat_t: 'base~' });
    expect(sufijo.state_topic).toBe('base/sufijo');
  });

  it('sin `~` no toca los topics', () => {
    const out = expandirConfig({ stat_t: 'esphome/luz/state' });
    expect(out.state_topic).toBe('esphome/luz/state');
  });
});

describe('plantillas de valor', () => {
  it('entiende `{{ value }}` y las rutas sobre value_json', () => {
    expect(compilarPlantilla(null)).toEqual({ tipo: 'directa' });
    expect(compilarPlantilla('{{ value }}')).toEqual({ tipo: 'directa' });
    expect(compilarPlantilla('{{value_json.POWER}}')).toEqual({ tipo: 'ruta', ruta: ['POWER'] });
    expect(compilarPlantilla("{{ value_json['ENERGY']['Power'] }}")).toEqual({
      tipo: 'ruta',
      ruta: ['ENERGY', 'Power'],
    });
    expect(compilarPlantilla('{{ value_json.a["b"].c }}')).toEqual({
      tipo: 'ruta',
      ruta: ['a', 'b', 'c'],
    });
  });

  it('extrae el valor y aguanta un payload que no es JSON', () => {
    const p = compilarPlantilla('{{value_json.POWER}}');
    expect(extraerValor(p, '{"POWER":"ON","Time":"x"}')).toBe('ON');
    expect(extraerValor(p, 'no soy json')).toBeNull();
    expect(extraerValor(p, '{"otra":1}')).toBeNull();
    expect(extraerValor({ tipo: 'directa' }, 'ON')).toBe('ON');
    expect(extraerValor(compilarPlantilla("{{ value_json['ENERGY']['Power'] }}"), '{"ENERGY":{"Power":42}}')).toBe('42');
  });

  it('⚠️ la ruta solo recorre propiedades PROPIAS del mensaje', () => {
    // La escribe quien publica en el broker. Sin la guarda, `constructor` o
    // `__proto__` devolverían como «lectura del sensor» algo que no está en el
    // mensaje (lo cazó el SAST al revisar esta historia).
    for (const tpl of ['{{ value_json.constructor }}', '{{ value_json.__proto__ }}', '{{ value_json.a.toString }}']) {
      expect(extraerValor(compilarPlantilla(tpl), '{"a":{"b":1}}'), tpl).toBeNull();
    }
    // Y lo que sí está en el mensaje se sigue leyendo.
    expect(extraerValor(compilarPlantilla('{{ value_json.a.b }}'), '{"a":{"b":1}}')).toBe('1');
  });

  it('⚠️ una plantilla Jinja2 de verdad NO se ejecuta: se declara no soportada', () => {
    // Es una decisión de seguridad, no una limitación que se descubra en runtime:
    // evaluar plantillas sería ejecutar código de terceros llegado por la red.
    for (const tpl of [
      '{% if value_json.x %}ON{% else %}OFF{% endif %}',
      '{{ value_json.x | float * 2 }}',
      '{{ states("sensor.otro") }}',
      '{{ value_json }}',
    ]) {
      expect(compilarPlantilla(tpl).tipo, tpl).toBe('no-soportada');
    }
    // Y no soportada significa «sin dato», nunca un valor inventado.
    expect(extraerValor(compilarPlantilla('{{ value_json.x | float }}'), '{"x":1}')).toBeNull();
  });
});

describe('parseDiscoveryConfig', () => {
  const topic = { component: 'switch', nodeId: null, objectId: 'relay1' };

  it('normaliza una config de ESPHome (claves completas)', () => {
    const e = parseDiscoveryConfig(topic, {
      name: 'Enchufe salón',
      state_topic: 'esphome/enchufe/state',
      command_topic: 'esphome/enchufe/command',
      availability_topic: 'esphome/enchufe/status',
      payload_available: 'online',
      unique_id: 'esphome-enchufe',
      device: { identifiers: ['esphome-abc'], name: 'Enchufe salón' },
    });
    expect(e).toMatchObject({
      component: 'switch',
      name: 'Enchufe salón',
      deviceKey: 'esphome-abc',
      deviceName: 'Enchufe salón',
      stateTopic: 'esphome/enchufe/state',
      commandTopic: 'esphome/enchufe/command',
      payloadOn: 'ON',
      payloadOff: 'OFF',
    });
    expect(e?.availability).toEqual([
      { topic: 'esphome/enchufe/status', online: 'online', offline: 'offline' },
    ]);
  });

  it('agrupa por el identificador del aparato, no por la entidad', () => {
    // Es lo que hace que un enchufe con medidor sea UN aparato con lecturas y no
    // tres aparatos sueltos (para eso US-244 volvió `readings` una lista).
    const rele = parseDiscoveryConfig(topic, { device: { identifiers: ['abc'] }, unique_id: 'abc_rl' });
    const potencia = parseDiscoveryConfig(
      { component: 'sensor', nodeId: null, objectId: 'pot' },
      { device: { identifiers: ['abc'] }, unique_id: 'abc_pw' },
    );
    expect(rele?.deviceKey).toBe('abc');
    expect(potencia?.deviceKey).toBe('abc');
  });

  it('sin bloque `device` cae al unique_id, y sanea la barra', () => {
    expect(parseDiscoveryConfig(topic, { unique_id: 'a/b c' })?.deviceKey).toBe('a_b_c');
    expect(saneaId('casa/luz#1 x')).toBe('casa_luz_1_x');
  });

  it('descarta componentes que el contrato no representa', () => {
    for (const component of ['fan', 'button', 'number', 'vacuum', 'siren']) {
      expect(parseDiscoveryConfig({ component, nodeId: null, objectId: 'x' }, { name: 'X' })).toBeNull();
    }
  });

  it('descarta un payload que no es un objeto', () => {
    expect(parseDiscoveryConfig(topic, 'texto')).toBeNull();
    expect(parseDiscoveryConfig(topic, [1, 2])).toBeNull();
    expect(parseDiscoveryConfig(topic, {})).toBeNull();
  });
});

describe('⚠️ no ingerir nuestra propia publicación', () => {
  it('reconoce el nodo, el unique_id y el identificador de KrakenOS', () => {
    expect(esNuestraPropiaConfig({ component: 'switch', nodeId: 'krakenos', objectId: 'x' }, {})).toBe(true);
    expect(
      esNuestraPropiaConfig({ component: 'switch', nodeId: null, objectId: 'x' }, { unique_id: 'krakenos_iot_1' }),
    ).toBe(true);
    expect(
      esNuestraPropiaConfig(
        { component: 'switch', nodeId: null, objectId: 'x' },
        { device: { identifiers: ['krakenos_hub'] } },
      ),
    ).toBe(true);
    expect(
      esNuestraPropiaConfig({ component: 'switch', nodeId: 'tasmota', objectId: 'x' }, { unique_id: 'x' }),
    ).toBe(false);
  });
});

describe('categoría del aparato', () => {
  it('resuelve las específicas ANTES que el interruptor (lección de US-244)', () => {
    expect(categoriaDeEntidades([entidad({ component: 'switch' }), entidad({ component: 'sensor' })])).toBe('plug');
    // Una persiana con sensor de posición sigue siendo una persiana: si ganara
    // `switch`, la UI le pintaría un interruptor y le mandaría ON.
    expect(categoriaDeEntidades([entidad({ component: 'switch' }), entidad({ component: 'cover' })])).toBe('cover');
    expect(categoriaDeEntidades([entidad({ component: 'switch' }), entidad({ component: 'light' })])).toBe('light');
    expect(categoriaDeEntidades([entidad({ component: 'switch' }), entidad({ component: 'lock' })])).toBe('lock');
    expect(categoriaDeEntidades([entidad({ component: 'climate' })])).toBe('climate');
  });

  it('clasifica los binarios por su device_class', () => {
    expect(categoriaDeEntidades([entidad({ component: 'binary_sensor', deviceClass: 'door' })])).toBe('contact');
    expect(categoriaDeEntidades([entidad({ component: 'binary_sensor', deviceClass: 'window' })])).toBe('contact');
    expect(categoriaDeEntidades([entidad({ component: 'binary_sensor', deviceClass: 'smoke' })])).toBe('smoke');
    // Humo antes que contacto en un detector combinado.
    expect(
      categoriaDeEntidades([
        entidad({ component: 'binary_sensor', deviceClass: 'door' }),
        entidad({ component: 'binary_sensor', deviceClass: 'smoke' }),
      ]),
    ).toBe('smoke');
    expect(categoriaDeEntidades([entidad({ component: 'binary_sensor', deviceClass: 'motion' })])).toBe('sensor');
    expect(categoriaDeEntidades([entidad({ component: 'sensor' })])).toBe('sensor');
  });
});

describe('métricas', () => {
  it('mapea el device_class de un sensor y cae a la unidad solo si no lo hay', () => {
    expect(metricaDeSensor('temperature', '°C')).toBe('temperature');
    expect(metricaDeSensor('power', 'W')).toBe('power');
    expect(metricaDeSensor(null, 'W')).toBe('power');
    expect(metricaDeSensor(null, 'kWh')).toBe('energy');
    // Un `%` a secas puede ser humedad o batería: adivinarlo sería inventar el dato.
    expect(metricaDeSensor(null, '%')).toBeNull();
    // Con clase declarada que no mapea, no se busca por unidad: la clase manda.
    expect(metricaDeSensor('pressure', 'W')).toBeNull();
  });

  it('mapea los binarios de seguridad y descarta el resto', () => {
    expect(metricaDeBinario('smoke')).toBe('smoke');
    expect(metricaDeBinario('gas')).toBe('smoke');
    expect(metricaDeBinario('carbon_monoxide')).toBe('co');
    expect(metricaDeBinario('door')).toBe('contact');
    expect(metricaDeBinario('motion')).toBe('occupancy');
    expect(metricaDeBinario('problem')).toBeNull();
    expect(metricaDeBinario(null)).toBeNull();
  });

  it('⚠️ un contacto NO se invierte aquí, y en zigbee2mqtt SÍ', () => {
    // El mismo sensor físico con la polaridad opuesta según el protocolo. Copiar
    // el mapeo del otro backend haría que la alarma saltara al CERRAR la puerta.
    const puerta = entidad({ component: 'binary_sensor', deviceClass: 'door' });
    expect(lecturaDeBinario(puerta, 'ON')).toEqual({ metric: 'contact', value: 1, unit: '' });
    expect(lecturaDeBinario(puerta, 'OFF')).toEqual({ metric: 'contact', value: 0, unit: '' });
    // zigbee2mqtt: `contact: true` significa CERRADO → 0.
    const z2m = parseDeviceState({ contact: true }).readings.find((r) => r.metric === 'contact');
    expect(z2m?.value).toBe(0);
    expect(parseDeviceState({ contact: false }).readings.find((r) => r.metric === 'contact')?.value).toBe(1);
  });

  it('una lectura de sensor exige un número', () => {
    const s = entidad({ component: 'sensor', deviceClass: 'temperature', unit: '°C' });
    expect(lecturaDeSensor(s, '21.5')).toEqual({ metric: 'temperature', value: 21.5, unit: '°C' });
    expect(lecturaDeSensor(s, 'unknown')).toBeNull();
    expect(lecturaDeSensor(entidad({ component: 'sensor', deviceClass: 'pressure' }), '1013')).toBeNull();
  });

  it('normaliza potencia y energía a W y Wh', () => {
    expect(normalizarEnergia({ metric: 'power', value: 1.5, unit: 'kW' })).toEqual({ powerW: 1500 });
    expect(normalizarEnergia({ metric: 'power', value: 40, unit: 'W' })).toEqual({ powerW: 40 });
    expect(normalizarEnergia({ metric: 'energy', value: 2, unit: 'kWh' })).toEqual({ energyWh: 2000 });
    expect(normalizarEnergia({ metric: 'battery', value: 90, unit: '%' })).toEqual({});
  });
});

describe('construirOrdenes', () => {
  it('enciende y apaga con los payloads que el aparato declara', () => {
    const sw = entidad({ component: 'switch', commandTopic: 'cmnd/x/POWER', payloadOn: '1', payloadOff: '0' });
    expect(construirOrdenes([sw], 'plug', { on: true })).toEqual([{ topic: 'cmnd/x/POWER', payload: '1' }]);
    expect(construirOrdenes([sw], 'plug', { on: false })).toEqual([{ topic: 'cmnd/x/POWER', payload: '0' }]);
  });

  it('convierte el brillo a la escala del aparato y enciende con él', () => {
    const luz = entidad({
      component: 'light',
      commandTopic: 'luz/set',
      brightnessCommandTopic: 'luz/bri/set',
      brightnessScale: 255,
    });
    expect(construirOrdenes([luz], 'light', { brightness: 100 })).toEqual([
      { topic: 'luz/bri/set', payload: '255' },
      { topic: 'luz/set', payload: 'ON' },
    ]);
    expect(construirOrdenes([luz], 'light', { brightness: 50, on: true })).toEqual([
      { topic: 'luz/set', payload: 'ON' },
      { topic: 'luz/bri/set', payload: '128' },
    ]);
    // Escala propia (ESPHome usa a veces 100).
    const cien = entidad({ component: 'light', brightnessCommandTopic: 'l/b', brightnessScale: 100 });
    expect(construirOrdenes([cien], 'light', { brightness: 40 })[0]).toEqual({ topic: 'l/b', payload: '40' });
  });

  it('una persiana va por posición, escalada a su propio rango', () => {
    const cover = entidad({
      component: 'cover',
      setPositionTopic: 'persiana/pos/set',
      commandTopic: 'persiana/set',
      positionOpen: 100,
      positionClosed: 0,
    });
    expect(construirOrdenes([cover], 'cover', { position: 30 })).toEqual([
      { topic: 'persiana/pos/set', payload: '30' },
    ]);
    // Rango invertido (algunos aparatos declaran 0 = abierta).
    const invertida = entidad({ component: 'cover', setPositionTopic: 'p', positionOpen: 0, positionClosed: 100 });
    expect(construirOrdenes([invertida], 'cover', { position: 25 })).toEqual([{ topic: 'p', payload: '75' }]);
    // Sin topic de posición, cae al abrir/cerrar declarado.
    const simple = entidad({ component: 'cover', commandTopic: 'p/set', payloadOpen: 'UP', payloadClose: 'DOWN' });
    expect(construirOrdenes([simple], 'cover', { on: true })).toEqual([{ topic: 'p/set', payload: 'UP' }]);
  });

  it('un termostato manda su consigna', () => {
    const clima = entidad({ component: 'climate', temperatureCommandTopic: 'clima/temp/set' });
    expect(construirOrdenes([clima], 'climate', { targetC: 21 })).toEqual([
      { topic: 'clima/temp/set', payload: '21' },
    ]);
  });

  it('sin topic de control declarado no inventa ninguno', () => {
    // Publicar en un topic inventado sería mandar la orden al vacío y decir «hecho».
    expect(construirOrdenes([entidad({ component: 'switch' })], 'plug', { on: true })).toEqual([]);
    expect(construirOrdenes([entidad({ component: 'cover' })], 'cover', { position: 10 })).toEqual([]);
    expect(construirOrdenes([entidad({ component: 'climate' })], 'climate', { targetC: 20 })).toEqual([]);
  });
});
