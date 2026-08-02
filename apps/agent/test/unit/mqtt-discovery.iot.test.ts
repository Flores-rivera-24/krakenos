import { beforeEach, describe, expect, it } from 'vitest';
import {
  type MqttMessageHandler,
  type MqttTransport,
  topicMatches,
} from '../../src/iot/mqtt.transport.js';
import { MqttDiscoveryIotManager } from '../../src/iot/mqtt-discovery.iot.js';
import { buildDiscoveryConfigs, type StateSnapshot } from '../../src/modules/interop/ha-discovery.js';

/**
 * US-248 — ingesta genérica por MQTT Discovery, contra un transporte falso.
 */

/** Transporte MQTT falso: enruta los mensajes emitidos por los filtros suscritos. */
class FakeMqtt implements MqttTransport {
  published: { topic: string; payload: string }[] = [];
  suscripciones: string[] = [];
  disposed = 0;
  private subs: { filter: string; handler: MqttMessageHandler }[] = [];

  async subscribe(filter: string, handler: MqttMessageHandler): Promise<void> {
    this.suscripciones.push(filter);
    this.subs.push({ filter, handler });
  }

  async publish(topic: string, payload: string): Promise<void> {
    this.published.push({ topic, payload });
  }

  async dispose(): Promise<void> {
    this.disposed++;
  }

  emit(topic: string, payload: unknown): void {
    const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
    for (const s of this.subs) if (topicMatches(s.filter, topic)) s.handler(topic, text);
  }
}

/** Deja correr las suscripciones dinámicas que dispara una config entrante. */
const flush = () => new Promise((r) => setTimeout(r, 0));

/** Config de un enchufe ESPHome con su sensor de potencia (mismo aparato). */
const ESPHOME_SWITCH = {
  name: 'Enchufe salón',
  state_topic: 'esphome/salon/switch/rele/state',
  command_topic: 'esphome/salon/switch/rele/command',
  availability_topic: 'esphome/salon/status',
  unique_id: 'esphome-salon-rele',
  device: { identifiers: ['esphome-salon'], name: 'Enchufe salón' },
};
const ESPHOME_POWER = {
  name: 'Potencia',
  state_topic: 'esphome/salon/sensor/potencia/state',
  unit_of_measurement: 'W',
  device_class: 'power',
  unique_id: 'esphome-salon-pot',
  device: { identifiers: ['esphome-salon'], name: 'Enchufe salón' },
};

describe('MqttDiscoveryIotManager', () => {
  let mqtt: FakeMqtt;
  let iot: MqttDiscoveryIotManager;
  const avisos: string[] = [];

  beforeEach(async () => {
    avisos.length = 0;
    mqtt = new FakeMqtt();
    iot = new MqttDiscoveryIotManager({ transport: mqtt, onAviso: (m) => avisos.push(m) });
    await iot.start();
  });

  it('se suscribe al namespace de anuncio y luego a los topics que el aparato declara', async () => {
    expect(mqtt.suscripciones).toEqual(['homeassistant/#']);
    mqtt.emit('homeassistant/switch/salon/rele/config', ESPHOME_SWITCH);
    await flush();
    // Los topics de estado no se pueden conocer de antemano: cada aparato publica
    // donde quiere, así que la suscripción es dinámica y viene DESPUÉS de la config.
    expect(mqtt.suscripciones).toContain('esphome/salon/switch/rele/state');
    expect(mqtt.suscripciones).toContain('esphome/salon/status');
  });

  it('no se suscribe dos veces al mismo topic', async () => {
    // El transporte no deduplica: suscribir dos veces entrega el mensaje dos veces.
    mqtt.emit('homeassistant/switch/salon/rele/config', ESPHOME_SWITCH);
    await flush();
    mqtt.emit('homeassistant/switch/salon/rele/config', ESPHOME_SWITCH);
    await flush();
    const veces = mqtt.suscripciones.filter((s) => s === 'esphome/salon/switch/rele/state').length;
    expect(veces).toBe(1);
  });

  it('agrupa las entidades de un aparato en UN dispositivo con sus lecturas', async () => {
    mqtt.emit('homeassistant/switch/salon/rele/config', ESPHOME_SWITCH);
    mqtt.emit('homeassistant/sensor/salon/pot/config', ESPHOME_POWER);
    await flush();
    mqtt.emit('esphome/salon/switch/rele/state', 'ON');
    mqtt.emit('esphome/salon/sensor/potencia/state', '42.5');

    const devices = await iot.listDevices();
    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({
      id: 'esphome-salon',
      name: 'Enchufe salón',
      kind: 'plug',
      on: true,
      reachable: true,
      powerW: 42.5,
    });
    expect(devices[0]?.readings).toEqual([{ metric: 'power', value: 42.5, unit: 'W' }]);
  });

  it('ingiere un enchufe Tasmota (abreviaturas, `~` y plantilla sobre un topic compartido)', async () => {
    // Tasmota publica TODO su estado en un solo topic y lo reparte con plantillas;
    // sin abreviaturas, sin `~` y sin plantillas no aparecería ni un aparato.
    mqtt.emit('homeassistant/switch/tasmota_ABC/1/config', {
      '~': 'tasmota_ABC/',
      name: 'Enchufe cocina',
      stat_t: '~tele/STATE',
      cmd_t: '~cmnd/POWER',
      val_tpl: '{{value_json.POWER}}',
      avty_t: '~tele/LWT',
      pl_avail: 'Online',
      pl_not_avail: 'Offline',
      uniq_id: 'ABC_RL_1',
      dev: { ids: ['ABC'], name: 'Enchufe cocina', mf: 'Tasmota' },
    });
    mqtt.emit('homeassistant/sensor/tasmota_ABC/pot/config', {
      '~': 'tasmota_ABC/',
      name: 'Potencia',
      stat_t: '~tele/SENSOR',
      val_tpl: "{{value_json['ENERGY']['Power']}}",
      unit_of_meas: 'W',
      dev_cla: 'power',
      uniq_id: 'ABC_pot',
      dev: { ids: ['ABC'] },
    });
    await flush();
    mqtt.emit('tasmota_ABC/tele/LWT', 'Online');
    mqtt.emit('tasmota_ABC/tele/STATE', { POWER: 'ON', Uptime: '1T00:00:00' });
    mqtt.emit('tasmota_ABC/tele/SENSOR', { ENERGY: { Power: 12, Total: 3 } });

    const [device] = await iot.listDevices();
    expect(device).toMatchObject({ id: 'ABC', name: 'Enchufe cocina', kind: 'plug', on: true, powerW: 12 });
  });

  it('una luz reporta brillo en la escala del aparato y lo acepta de vuelta', async () => {
    mqtt.emit('homeassistant/light/salon/luz/config', {
      name: 'Lámpara',
      state_topic: 'luz/state',
      command_topic: 'luz/set',
      brightness_state_topic: 'luz/brightness',
      brightness_command_topic: 'luz/brightness/set',
      brightness_scale: 255,
      unique_id: 'luz1',
      device: { identifiers: ['luz1'], name: 'Lámpara' },
    });
    await flush();
    mqtt.emit('luz/state', 'ON');
    mqtt.emit('luz/brightness', '128');

    const [device] = await iot.listDevices();
    expect(device).toMatchObject({ kind: 'light', on: true, brightness: 50 });

    await iot.setState('luz1', { brightness: 100 });
    expect(mqtt.published).toEqual([
      { topic: 'luz/brightness/set', payload: '255' },
      { topic: 'luz/set', payload: 'ON' },
    ]);
  });

  it('un sensor de apertura es `contact` y publica 1 cuando está abierto', async () => {
    mqtt.emit('homeassistant/binary_sensor/puerta/config', {
      name: 'Puerta',
      state_topic: 'puerta/state',
      device_class: 'door',
      unique_id: 'puerta1',
      device: { identifiers: ['puerta1'], name: 'Puerta de entrada' },
    });
    await flush();
    mqtt.emit('puerta/state', 'ON');

    const [device] = await iot.listDevices();
    expect(device?.kind).toBe('contact');
    expect(device?.readings).toEqual([{ metric: 'contact', value: 1, unit: '' }]);
    expect(device?.on).toBeNull(); // un contacto no se enciende
  });

  it('una persiana reporta posición y acepta una nueva', async () => {
    mqtt.emit('homeassistant/cover/persiana/config', {
      name: 'Persiana',
      position_topic: 'persiana/pos',
      set_position_topic: 'persiana/pos/set',
      unique_id: 'pers1',
      device: { identifiers: ['pers1'], name: 'Persiana' },
    });
    await flush();
    mqtt.emit('persiana/pos', '40');

    const [device] = await iot.listDevices();
    expect(device).toMatchObject({ kind: 'cover', position: 40 });

    await iot.setState('pers1', { position: 80 });
    expect(mqtt.published).toEqual([{ topic: 'persiana/pos/set', payload: '80' }]);
  });

  it('un payload vacío da de BAJA al aparato (así se borra un retenido)', async () => {
    mqtt.emit('homeassistant/switch/salon/rele/config', ESPHOME_SWITCH);
    await flush();
    expect(await iot.listDevices()).toHaveLength(1);
    mqtt.emit('homeassistant/switch/salon/rele/config', '');
    expect(await iot.listDevices()).toHaveLength(0);
  });

  it('un aparato no disponible se lista, pero sin estados ni lecturas (US-242)', async () => {
    mqtt.emit('homeassistant/switch/salon/rele/config', ESPHOME_SWITCH);
    mqtt.emit('homeassistant/sensor/salon/pot/config', ESPHOME_POWER);
    await flush();
    mqtt.emit('esphome/salon/switch/rele/state', 'ON');
    mqtt.emit('esphome/salon/sensor/potencia/state', '42.5');
    mqtt.emit('esphome/salon/status', 'offline');

    const [device] = await iot.listDevices();
    // Desaparecer haría indistinguible «apagado» de «desenchufado»; conservar el
    // último valor sería una mentira con pinta de dato fresco.
    expect(device).toMatchObject({ reachable: false, on: null, powerW: null });
    expect(device?.readings).toEqual([]);

    mqtt.emit('esphome/salon/status', 'online');
    expect((await iot.listDevices())[0]).toMatchObject({ reachable: true, on: true });
  });

  it('encender publica el payload que el aparato declaró', async () => {
    mqtt.emit('homeassistant/switch/salon/rele/config', { ...ESPHOME_SWITCH, payload_on: '1', payload_off: '0' });
    await flush();
    const device = await iot.setState('esphome-salon', { on: true });
    expect(mqtt.published).toEqual([{ topic: 'esphome/salon/switch/rele/command', payload: '1' }]);
    expect(device.on).toBe(true); // optimista, hasta que el aparato confirme
  });

  it('⚠️ una cerradura NO acepta órdenes: es la decisión de US-246', async () => {
    mqtt.emit('homeassistant/lock/puerta/config', {
      name: 'Cerradura',
      state_topic: 'cerradura/state',
      command_topic: 'cerradura/set',
      unique_id: 'cerr1',
      device: { identifiers: ['cerr1'], name: 'Cerradura' },
    });
    await flush();
    mqtt.emit('cerradura/state', 'LOCKED');

    const [device] = await iot.listDevices();
    expect(device).toMatchObject({ kind: 'lock', locked: true });
    await expect(iot.setState('cerr1', { on: true })).rejects.toThrow(/no acepta órdenes/i);
    expect(mqtt.published).toEqual([]);
  });

  it('sin topic de control declarado, falla en vez de fingir que se aplicó', async () => {
    mqtt.emit('homeassistant/switch/solo-lectura/config', {
      name: 'Solo lectura',
      state_topic: 'x/state',
      unique_id: 'ro1',
      device: { identifiers: ['ro1'], name: 'Solo lectura' },
    });
    await flush();
    await expect(iot.setState('ro1', { on: true })).rejects.toThrow(/no publica un control/i);
    expect(mqtt.published).toEqual([]);
  });

  it('un dispositivo desconocido no existe', async () => {
    await expect(iot.setState('no-existe', { on: true })).rejects.toThrow(/no encontrado/i);
  });

  it('aguanta basura y mensajes que no son configs', async () => {
    expect(() => mqtt.emit('homeassistant/switch/x/config', 'no soy json')).not.toThrow();
    expect(() => mqtt.emit('homeassistant/status', 'online')).not.toThrow();
    expect(() => mqtt.emit('homeassistant/fan/x/config', { name: 'Ventilador' })).not.toThrow();
    expect(await iot.listDevices()).toHaveLength(0);
  });

  it('descarta configs por encima del tope y lo AVISA', async () => {
    const corto = new MqttDiscoveryIotManager({ transport: mqtt, maxEntidades: 2, onAviso: (m) => avisos.push(m) });
    await corto.start();
    for (let i = 0; i < 5; i++) {
      mqtt.emit(`homeassistant/switch/d${i}/config`, {
        name: `D${i}`,
        unique_id: `d${i}`,
        device: { identifiers: [`d${i}`] },
      });
    }
    await flush();
    expect(await corto.listDevices()).toHaveLength(2);
    // El broker no tiene sujeto: cualquiera con sus credenciales puede publicar,
    // así que el tope existe — pero callárselo dejaría media casa sin explicación.
    expect(avisos.some((a) => /tope de 2 entidades/i.test(a))).toBe(true);
  });

  it('descarta una config descomunal antes de parsearla', async () => {
    mqtt.emit('homeassistant/switch/gordo/config', JSON.stringify({ name: 'x'.repeat(40_000) }));
    await flush();
    expect(await iot.listDevices()).toHaveLength(0);
    expect(avisos.some((a) => /tamaño/i.test(a))).toBe(true);
  });

  it('libera la conexión al parar', async () => {
    await iot.stop();
    expect(mqtt.disposed).toBe(1);
  });
});

describe('⚠️ KrakenOS no se ingiere a sí mismo', () => {
  it('ignora las configs que publica su propio MQTT Discovery (US-213)', async () => {
    // Se alimenta al consumidor con la salida REAL del publicador: si un día
    // cambian los ids o el nodo, este test lo caza en vez de aparecer como una
    // casa duplicada en producción.
    const snapshot: StateSnapshot = {
      iot: [
        { id: 'hue:foco-1', name: 'Foco salón', kind: 'light', on: true, brightness: 80, color: null, powerW: 9 },
      ],
      energy: { todayKwh: 1.2, todayCost: 0.3, currency: 'EUR' },
      devicesOnline: 4,
      homeMode: 'home',
      alarmPhase: 'disarmed',
      blockedDevices: [{ id: 'dev1', name: 'Tablet', blocked: true, reasons: ['schedule'] }],
      roomSignals: [{ id: 'room1', name: 'Salón', worstDbm: -60 }],
    };
    const mqtt = new FakeMqtt();
    const iot = new MqttDiscoveryIotManager({ transport: mqtt });
    await iot.start();

    const configs = buildDiscoveryConfigs(snapshot, 'krakenos', { iot: true, pause: true });
    expect(configs.length).toBeGreaterThan(3); // guard: si el publicador no emitió nada, esto no prueba nada
    for (const msg of configs) mqtt.emit(msg.topic, msg.payload);
    await flush();

    // Sin este filtro cada aparato aparecería dos veces, la energía se contaría
    // por duplicado y encender la copia publicaría en NUESTRO propio command_topic:
    // un bucle de órdenes con el anti-bucle de automatizaciones fuera de juego.
    expect(await iot.listDevices()).toEqual([]);
  });
});
