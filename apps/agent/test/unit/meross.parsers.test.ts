import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildSystemAll,
  buildToggleX,
  extractChannelStates,
  merossCmdTopic,
  merossToIotDevice,
  parseMerossId,
  parseMerossMessage,
  rgbIntToHex,
  uuidFromTopic,
} from '../../src/iot/meross.parsers.js';

const CTX = { key: 'secretkey', messageId: 'mid123', timestamp: 1_700_000_000 };

describe('meross.parsers', () => {
  it('topics: cmd/resp y extracción de uuid', () => {
    expect(merossCmdTopic('uuid-1')).toBe('m/v1/uuid-1/subscribe');
    expect(uuidFromTopic('m/v1/uuid-1/publish')).toBe('uuid-1');
    expect(uuidFromTopic('m/v1/uuid-1/subscribe')).toBeNull();
  });

  it('buildToggleX firma el mensaje con md5(messageId+key+timestamp)', () => {
    const msg = JSON.parse(buildToggleX(2, true, CTX));
    expect(msg.header).toMatchObject({ namespace: 'Appliance.Control.ToggleX', method: 'SET', messageId: 'mid123' });
    expect(msg.payload).toEqual({ togglex: { channel: 2, onoff: 1 } });
    const expectedSign = createHash('md5').update('mid123secretkey1700000000').digest('hex');
    expect(msg.header.sign).toBe(expectedSign);
  });

  it('buildSystemAll genera un GET Appliance.System.All', () => {
    const msg = JSON.parse(buildSystemAll(CTX));
    expect(msg.header).toMatchObject({ namespace: 'Appliance.System.All', method: 'GET' });
    expect(msg.payload).toEqual({});
  });

  it('parseMerossMessage extrae namespace y payload (o null si no es JSON)', () => {
    const text = JSON.stringify({ header: { namespace: 'Appliance.System.All' }, payload: { all: {} } });
    expect(parseMerossMessage(text)).toEqual({ namespace: 'Appliance.System.All', payload: { all: {} } });
    expect(parseMerossMessage('no-json')).toBeNull();
  });

  it('extractChannelStates mapea digest.togglex (multi-canal) y digest.light', () => {
    const payload = {
      all: {
        digest: {
          togglex: [
            { channel: 0, onoff: 1 },
            { channel: 1, onoff: 0 },
          ],
          light: [{ channel: 0, luminance: 80, rgb: 0x00ff00, onoff: 1 }],
        },
      },
    };
    const states = extractChannelStates(payload);
    expect(states.get(1)).toMatchObject({ on: false, isLight: false });
    expect(states.get(0)).toMatchObject({ on: true, isLight: true, brightness: 80 });
    expect(states.get(0)!.color?.hex).toBe('#00ff00');
  });

  it('rgbIntToHex, merossToIotDevice y parseMerossId', () => {
    expect(rgbIntToHex(0xff8800)).toBe('#ff8800');
    const dev = merossToIotDevice({ uuid: 'u1', name: 'Regleta', channels: 2, key: 'k' }, 1, {
      on: true,
      brightness: null,
      color: null,
      isLight: false,
    });
    expect(dev).toMatchObject({ id: 'meross:u1:1', name: 'Regleta (2)', kind: 'plug', on: true, reachable: true });
    expect(parseMerossId('meross:u1:1')).toEqual({ uuid: 'u1', channel: 1 });
    expect(parseMerossId('nope')).toBeNull();
  });
});
