import { beforeEach, describe, expect, it } from 'vitest';
import { GoveeIotManager } from '../../src/iot/govee.iot.js';
import type { UdpMessageHandler, UdpTransport } from '../../src/iot/govee.transport.js';

/** Transporte UDP falso: registra envíos y permite inyectar datagramas entrantes. */
class FakeUdp implements UdpTransport {
  unicast: { ip: string; port: number; payload: string }[] = [];
  multicast: { group: string; port: number; payload: string }[] = [];
  private handler?: UdpMessageHandler;

  async send(ip: string, port: number, payload: string): Promise<void> {
    this.unicast.push({ ip, port, payload });
  }
  async sendMulticast(group: string, port: number, payload: string): Promise<void> {
    this.multicast.push({ group, port, payload });
  }
  onMessage(handler: UdpMessageHandler): void {
    this.handler = handler;
  }
  emit(payload: unknown, fromIp: string): void {
    this.handler?.(typeof payload === 'string' ? payload : JSON.stringify(payload), fromIp);
  }
}

const SCAN = (ip: string, device: string, sku = 'H6159') => ({
  msg: { cmd: 'scan', data: { ip, device, sku } },
});

describe('GoveeIotManager', () => {
  let udp: FakeUdp;
  let govee: GoveeIotManager;

  beforeEach(async () => {
    udp = new FakeUdp();
    govee = new GoveeIotManager({ transport: udp });
    await govee.start();
  });

  it('start envía el scan multicast', () => {
    expect(udp.multicast[0]!.payload).toContain('"cmd":"scan"');
  });

  it('registra dispositivos del scan y pide su estado', async () => {
    udp.emit(SCAN('10.0.0.5', 'AA:BB'), '10.0.0.5');
    // Tras descubrirlo, pide estado al puerto de control (4003).
    const status = udp.unicast.find((u) => u.port === 4003);
    expect(status!.payload).toContain('"cmd":"devStatus"');

    udp.emit({ msg: { cmd: 'devStatus', data: { onOff: 1, brightness: 70, color: { r: 0, g: 255, b: 0 } } } }, '10.0.0.5');

    const dev = await govee.getDevice('AA:BB');
    expect(dev).toMatchObject({ id: 'AA:BB', on: true, brightness: 70, color: { hex: '#00ff00' } });
  });

  it('lista los dispositivos descubiertos', async () => {
    udp.emit(SCAN('10.0.0.5', 'AA:BB'), '10.0.0.5');
    udp.emit(SCAN('10.0.0.6', 'CC:DD', 'H6160'), '10.0.0.6');
    expect((await govee.listDevices()).map((d) => d.id).sort()).toEqual(['AA:BB', 'CC:DD']);
  });

  it('setState envía los comandos a la IP del dispositivo y actualiza optimista', async () => {
    udp.emit(SCAN('10.0.0.5', 'AA:BB'), '10.0.0.5');
    udp.unicast = [];

    const updated = await govee.setState('AA:BB', { on: true, brightness: 50 });
    expect(updated).toMatchObject({ on: true, brightness: 50 });
    const cmds = udp.unicast.filter((u) => u.ip === '10.0.0.5' && u.port === 4003).map((u) => u.payload);
    expect(cmds.some((p) => p.includes('"cmd":"turn"'))).toBe(true);
    expect(cmds.some((p) => p.includes('"cmd":"brightness"'))).toBe(true);
  });

  it('setState lanza IOT_NOT_FOUND si el dispositivo no se ha descubierto', async () => {
    await expect(govee.setState('NO:PE', { on: true })).rejects.toMatchObject({ code: 'IOT_NOT_FOUND' });
  });
});
