import { beforeEach, describe, expect, it } from 'vitest';
import { type MqttMessageHandler, type MqttTransport, topicMatches } from '../../src/iot/mqtt.transport.js';
import { ZigbeeIotManager } from '../../src/iot/zigbee.iot.js';

/** Transporte MQTT falso: enruta los mensajes emitidos por los filtros suscritos. */
class FakeMqtt implements MqttTransport {
  published: { topic: string; payload: string }[] = [];
  private subs: { filter: string; handler: MqttMessageHandler }[] = [];

  async subscribe(filter: string, handler: MqttMessageHandler): Promise<void> {
    this.subs.push({ filter, handler });
  }

  async publish(topic: string, payload: string): Promise<void> {
    this.published.push({ topic, payload });
  }

  /** Simula un mensaje del broker, entregándolo a los handlers que casan. */
  emit(topic: string, payload: unknown): void {
    const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
    for (const s of this.subs) if (topicMatches(s.filter, topic)) s.handler(topic, text);
  }
}

const BRIDGE_DEVICES = [
  { type: 'Coordinator', friendly_name: 'Coordinator' },
  { type: 'Router', friendly_name: 'luz_salon', definition: { exposes: [{ type: 'light', features: [{ name: 'state' }, { name: 'brightness' }] }] } },
  { type: 'Router', friendly_name: 'enchufe_tv', definition: { exposes: [{ type: 'switch', features: [{ name: 'state' }] }] } },
  { type: 'EndDevice', friendly_name: 'sensor_temp', definition: { exposes: [{ name: 'temperature' }] } },
];

describe('ZigbeeIotManager', () => {
  let mqtt: FakeMqtt;
  let iot: ZigbeeIotManager;

  beforeEach(async () => {
    mqtt = new FakeMqtt();
    iot = new ZigbeeIotManager({ transport: mqtt });
    await iot.start();
    mqtt.emit('zigbee2mqtt/bridge/devices', BRIDGE_DEVICES);
  });

  it('lista los dispositivos del bridge (sin el coordinador) con su categoría', async () => {
    const devices = await iot.listDevices();
    expect(devices.map((d) => `${d.id}:${d.kind}`)).toEqual([
      'luz_salon:light',
      'enchufe_tv:plug',
      'sensor_temp:sensor',
    ]);
  });

  it('fusiona los mensajes de estado en el dispositivo', async () => {
    mqtt.emit('zigbee2mqtt/luz_salon', { state: 'ON', brightness: 254 });
    mqtt.emit('zigbee2mqtt/sensor_temp', { temperature: 21.5 });

    const luz = await iot.getDevice('luz_salon');
    expect(luz).toMatchObject({ on: true, brightness: 100, reading: null });
    const sensor = await iot.getDevice('sensor_temp');
    expect(sensor).toMatchObject({ on: null, brightness: null, reading: { metric: 'temperatura', value: 21.5 } });
  });

  it('refleja la disponibilidad en reachable', async () => {
    mqtt.emit('zigbee2mqtt/enchufe_tv/availability', { state: 'offline' });
    expect((await iot.getDevice('enchufe_tv'))!.reachable).toBe(false);
  });

  it('getDevice devuelve null para id desconocido', async () => {
    expect(await iot.getDevice('no-existe')).toBeNull();
  });

  it('setState publica el set y actualiza la caché de forma optimista', async () => {
    const updated = await iot.setState('luz_salon', { brightness: 50 });
    expect(updated).toMatchObject({ on: true, brightness: 50 });

    const pub = mqtt.published.find((p) => p.topic === 'zigbee2mqtt/luz_salon/set');
    expect(JSON.parse(pub!.payload)).toEqual({ brightness: 127, state: 'ON' });
  });

  it('setState lanza IOT_NOT_FOUND y IOT_NOT_CONTROLLABLE', async () => {
    await expect(iot.setState('no-existe', { on: true })).rejects.toMatchObject({ code: 'IOT_NOT_FOUND' });
    await expect(iot.setState('sensor_temp', { on: true })).rejects.toMatchObject({
      code: 'IOT_NOT_CONTROLLABLE',
    });
    expect(mqtt.published.some((p) => p.topic.includes('sensor_temp'))).toBe(false);
  });

  it('start es idempotente (no resuscribe)', async () => {
    const before = await iot.listDevices();
    await iot.start();
    expect(await iot.listDevices()).toHaveLength(before.length);
  });
});
