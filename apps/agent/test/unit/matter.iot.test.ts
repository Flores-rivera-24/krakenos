import { beforeEach, describe, expect, it } from 'vitest';
import { MatterIotManager } from '../../src/iot/matter.iot.js';
import type { WsTransport } from '../../src/iot/matter.transport.js';

const NODES = [
  { node_id: 4, available: true, attributes: { '1/6/0': false, '1/8/0': 0, '0/40/5': 'Lámpara' } },
  { node_id: 5, available: true, attributes: { '1/6/0': true, '0/40/3': 'Plug' } },
  { node_id: 6, available: true, attributes: { '1/1026/0': 2150 } },
];

/** Transporte WS falso: responde cada petición por su `message_id` y registra los comandos. */
class FakeWs implements WsTransport {
  sent: { command: string; args: Record<string, unknown> }[] = [];
  result: (command: string) => unknown = (command) => (command === 'get_nodes' ? NODES : null);
  private handler?: (data: string) => void;

  onMessage(handler: (data: string) => void): void {
    this.handler = handler;
  }

  async send(data: string): Promise<void> {
    const msg = JSON.parse(data) as { message_id: string; command: string; args: Record<string, unknown> };
    this.sent.push({ command: msg.command, args: msg.args });
    this.handler?.(JSON.stringify({ message_id: msg.message_id, result: this.result(msg.command) }));
  }
}

describe('MatterIotManager', () => {
  let ws: FakeWs;
  let iot: MatterIotManager;

  beforeEach(() => {
    ws = new FakeWs();
    iot = new MatterIotManager({ transport: ws });
  });

  it('lista los nodos como dispositivos', async () => {
    const devices = await iot.listDevices();
    expect(devices.map((d) => `${d.id}:${d.kind}`)).toEqual(['4:light', '5:plug', '6:sensor']);
  });

  it('getDevice mapea por node_id o devuelve null', async () => {
    expect((await iot.getDevice('5'))!.name).toBe('Plug');
    expect(await iot.getDevice('999')).toBeNull();
  });

  it('setState envía device_command (OnOff + LevelControl) y devuelve estado optimista', async () => {
    const updated = await iot.setState('4', { brightness: 50 });
    expect(updated).toMatchObject({ id: '4', on: true, brightness: 50 });

    const cmds = ws.sent.filter((s) => s.command === 'device_command');
    expect(cmds.map((c) => c.args.cluster_id)).toContain(8);
    expect(cmds.find((c) => c.args.cluster_id === 8)!.args.payload).toMatchObject({ level: 127 });
  });

  it('setState de un enchufe envía On/Off por el cluster OnOff', async () => {
    await iot.setState('5', { on: false });
    const cmd = ws.sent.find((s) => s.command === 'device_command');
    expect(cmd!.args).toMatchObject({ node_id: 5, cluster_id: 6, command_name: 'Off' });
  });

  it('setState lanza IOT_NOT_FOUND / IOT_NOT_CONTROLLABLE sin mandar comandos', async () => {
    await expect(iot.setState('999', { on: true })).rejects.toMatchObject({ code: 'IOT_NOT_FOUND' });
    await expect(iot.setState('6', { on: true })).rejects.toMatchObject({ code: 'IOT_NOT_CONTROLLABLE' });
    expect(ws.sent.some((s) => s.command === 'device_command')).toBe(false);
  });
});
