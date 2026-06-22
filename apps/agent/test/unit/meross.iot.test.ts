import { describe, expect, it } from 'vitest';
import { MerossIotManager } from '../../src/iot/meross.iot.js';
import { buildSystemAll } from '../../src/iot/meross.parsers.js';
import type { MqttMessageHandler, MqttTransport } from '../../src/iot/mqtt.transport.js';

class FakeMqtt implements MqttTransport {
  published: { topic: string; payload: string }[] = [];
  private handlers: { filter: string; handler: MqttMessageHandler }[] = [];

  async subscribe(filter: string, handler: MqttMessageHandler): Promise<void> {
    this.handlers.push({ filter, handler });
  }
  async publish(topic: string, payload: string): Promise<void> {
    this.published.push({ topic, payload });
  }
  /** Simula un mensaje del broker en un topic. */
  emit(topic: string, payload: string): void {
    for (const { handler } of this.handlers) handler(topic, payload);
  }
}

const CTX = { now: () => 1_700_000_000_000, genMessageId: () => 'mid' };

const DEVICE = { uuid: 'u1', name: 'Enchufe', channels: 1, key: 'k1' };

function systemAllPayload(onoff: number) {
  return JSON.stringify({
    header: { namespace: 'Appliance.System.All' },
    payload: { all: { digest: { togglex: [{ channel: 0, onoff }] } } },
  });
}

describe('MerossIotManager', () => {
  it('start se suscribe a las respuestas y pide el estado inicial', async () => {
    const mqtt = new FakeMqtt();
    const mgr = new MerossIotManager({ transport: mqtt, devices: [DEVICE], ...CTX });
    await mgr.start();
    expect(mqtt.published[0]).toEqual({ topic: 'm/v1/u1/subscribe', payload: buildSystemAll({ key: 'k1', messageId: 'mid', timestamp: 1_700_000_000 }) });
  });

  it('listDevices refleja el estado recibido por el topic de publish', async () => {
    const mqtt = new FakeMqtt();
    const mgr = new MerossIotManager({ transport: mqtt, devices: [DEVICE], ...CTX });
    await mgr.start();
    // Antes de recibir nada: reachable false.
    expect((await mgr.listDevices())[0]).toMatchObject({ id: 'meross:u1:0', reachable: false });
    // El broker entrega el estado.
    mqtt.emit('m/v1/u1/publish', systemAllPayload(1));
    expect((await mgr.listDevices())[0]).toMatchObject({ id: 'meross:u1:0', on: true, reachable: true });
  });

  it('setState publica un ToggleX en el topic correcto y actualiza optimista', async () => {
    const mqtt = new FakeMqtt();
    const mgr = new MerossIotManager({ transport: mqtt, devices: [DEVICE], ...CTX });
    const dev = await mgr.setState('meross:u1:0', { on: true });
    const toggle = mqtt.published.find((p) => p.payload.includes('Appliance.Control.ToggleX'));
    expect(toggle!.topic).toBe('m/v1/u1/subscribe');
    expect(JSON.parse(toggle!.payload).payload).toEqual({ togglex: { channel: 0, onoff: 1 } });
    expect(dev).toMatchObject({ on: true });
  });

  it('ignora mensajes de uuids no configurados y lanza si el id no existe', async () => {
    const mqtt = new FakeMqtt();
    const mgr = new MerossIotManager({ transport: mqtt, devices: [DEVICE], ...CTX });
    await mgr.start();
    mqtt.emit('m/v1/desconocido/publish', systemAllPayload(1)); // no afecta
    expect((await mgr.listDevices())[0]).toMatchObject({ reachable: false });
    await expect(mgr.setState('meross:otro:0', { on: true })).rejects.toThrow(/no encontrado/i);
  });

  it('multi-canal: un device de 2 canales expone 2 IotDevice', async () => {
    const mqtt = new FakeMqtt();
    const mgr = new MerossIotManager({ transport: mqtt, devices: [{ ...DEVICE, channels: 2 }], ...CTX });
    const devices = await mgr.listDevices();
    expect(devices.map((d) => d.id)).toEqual(['meross:u1:0', 'meross:u1:1']);
  });
});
