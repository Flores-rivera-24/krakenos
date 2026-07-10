import { describe, expect, it } from 'vitest';
import { CompositeIotManager } from '../../src/iot/composite.iot.js';
import { MatterCommissionError, MatterIotManager } from '../../src/iot/matter.iot.js';
import { MockIotManager } from '../../src/iot/mock.iot.js';
import type { WsTransport } from '../../src/iot/matter.transport.js';
import {
  buildCommissionArgs,
  classifyCommissionError,
  parseCommissionResult,
} from '../../src/iot/matter.parsers.js';

const NODES = [{ node_id: 7, available: true, attributes: { '1/6/0': true, '0/40/5': 'Enchufe nuevo' } }];

/**
 * Transporte WS falso que puede responder con éxito o con error por comando, para
 * ejercer el comisionado (US-172) sin python-matter-server.
 */
class FakeWs implements WsTransport {
  sent: { command: string; args: Record<string, unknown> }[] = [];
  private handler?: (data: string) => void;
  /** Comando → respuesta; si devuelve `{__error}` se emite un error de Matter. */
  responder: (command: string) => unknown = (command) =>
    command === 'get_nodes' ? NODES : command === 'commission_with_code' ? { node_id: 7 } : null;

  async dispose(): Promise<void> {}
  onMessage(handler: (data: string) => void): void {
    this.handler = handler;
  }
  async send(data: string): Promise<void> {
    const msg = JSON.parse(data) as { message_id: string; command: string; args: Record<string, unknown> };
    this.sent.push({ command: msg.command, args: msg.args });
    const res = this.responder(msg.command) as { __error?: string } | unknown;
    if (res && typeof res === 'object' && '__error' in (res as object)) {
      this.handler?.(
        JSON.stringify({ message_id: msg.message_id, error_code: 1, details: (res as { __error: string }).__error }),
      );
    } else {
      this.handler?.(JSON.stringify({ message_id: msg.message_id, result: res }));
    }
  }
}

describe('comisionado Matter (US-172)', () => {
  describe('parsers puros', () => {
    it('buildCommissionArgs pasa el código saneado y permite BLE', () => {
      expect(buildCommissionArgs('  MT:ABC  ')).toEqual({ code: 'MT:ABC', network_only: false });
    });
    it('parseCommissionResult extrae el node_id (directo o envuelto)', () => {
      expect(parseCommissionResult({ node_id: 9 })).toEqual({ nodeId: 9 });
      expect(parseCommissionResult({ node: { node_id: 9 } })).toEqual({ nodeId: 9 });
      expect(parseCommissionResult({})).toBeNull();
    });
    it('classifyCommissionError mapea a códigos estables', () => {
      expect(classifyCommissionError('Invalid QR code')).toBe('invalid-code');
      expect(classifyCommissionError('Thread network has no border router')).toBe('thread-no-border');
      expect(classifyCommissionError('Device discovery timeout')).toBe('not-found');
      expect(classifyCommissionError('boom')).toBe('failed');
    });
  });

  it('MatterIotManager.commission envía commission_with_code y devuelve el nodo', async () => {
    const ws = new FakeWs();
    const iot = new MatterIotManager({ transport: ws });
    const result = await iot.commission('MT:ABC123');
    expect(ws.sent.some((s) => s.command === 'commission_with_code')).toBe(true);
    expect(result).toEqual({ deviceId: '7', name: 'Enchufe nuevo' });
  });

  it('un fallo del controlador se clasifica en MatterCommissionError', async () => {
    const ws = new FakeWs();
    ws.responder = (cmd) =>
      cmd === 'commission_with_code' ? { __error: 'Invalid pairing code' } : NODES;
    const iot = new MatterIotManager({ transport: ws });
    await expect(iot.commission('bad')).rejects.toMatchObject({
      code: 'invalid-code',
    });
    await expect(iot.commission('bad')).rejects.toBeInstanceOf(MatterCommissionError);
  });

  it('un resultado sin node_id es un fallo genérico', async () => {
    const ws = new FakeWs();
    ws.responder = (cmd) => (cmd === 'commission_with_code' ? {} : NODES);
    const iot = new MatterIotManager({ transport: ws });
    await expect(iot.commission('MT:X')).rejects.toMatchObject({ code: 'failed' });
  });

  describe('composite', () => {
    it('delega en el miembro Matter y prefija el id resultante', async () => {
      const ws = new FakeWs();
      const matter = new MatterIotManager({ transport: ws });
      const composite = new CompositeIotManager([
        { prefix: 'mock', manager: new MockIotManager() },
        { prefix: 'matter', manager: matter },
      ]);
      expect(typeof composite.commission).toBe('function');
      const result = await composite.commission!('MT:ABC');
      expect(result.deviceId).toBe('matter:7');
    });

    it('sin miembro Matter, commission es undefined', () => {
      const composite = new CompositeIotManager([{ prefix: 'mock', manager: new MockIotManager() }]);
      expect(composite.commission).toBeUndefined();
    });
  });
});
