import { describe, expect, it } from 'vitest';
import {
  buildCommands,
  hexToRgbString,
  parseDeviceList,
  parseDeviceStatus,
  parseSwitchBotId,
  rgbStringToHex,
  supportedKind,
} from '../../src/iot/switchbot.parsers.js';

describe('switchbot.parsers', () => {
  it('supportedKind clasifica los tipos soportados y descarta el resto', () => {
    expect(supportedKind('Bot')).toBe('plug');
    expect(supportedKind('Plug Mini (US)')).toBe('plug');
    expect(supportedKind('Color Bulb')).toBe('light');
    expect(supportedKind('Strip Light')).toBe('light');
    expect(supportedKind('Meter')).toBeNull();
    expect(supportedKind('Curtain')).toBeNull();
  });

  it('parseDeviceList mapea y filtra por tipo soportado', () => {
    const body = {
      deviceList: [
        { deviceId: 'AA1', deviceName: 'Enchufe', deviceType: 'Plug Mini (US)' },
        { deviceId: 'BB2', deviceName: 'Bombilla', deviceType: 'Color Bulb' },
        { deviceId: 'CC3', deviceName: 'Termómetro', deviceType: 'Meter' }, // se filtra
      ],
    };
    const devices = parseDeviceList(body);
    expect(devices.map((d) => d.id)).toEqual(['switchbot:AA1', 'switchbot:BB2']);
    expect(devices[0]).toMatchObject({ kind: 'plug', name: 'Enchufe', reachable: true });
    expect(devices[1]).toMatchObject({ kind: 'light', name: 'Bombilla' });
  });

  it('parseDeviceStatus lee power/brightness/color de una bombilla', () => {
    const body = { deviceId: 'BB2', deviceType: 'Color Bulb', power: 'on', brightness: 70, color: '255:128:0' };
    const dev = parseDeviceStatus(body);
    expect(dev).toMatchObject({ id: 'switchbot:BB2', kind: 'light', on: true, brightness: 70 });
    expect(dev!.color?.hex).toBe('#ff8000');
  });

  it('rgbStringToHex y hexToRgbString son consistentes', () => {
    expect(rgbStringToHex('255:128:0')).toBe('#ff8000');
    expect(rgbStringToHex('mal')).toBeNull();
    expect(hexToRgbString('#ff8000')).toBe('255:128:0');
  });

  it('buildCommands genera los comandos turnOn/setBrightness/setColor', () => {
    expect(buildCommands({ on: true })).toEqual([
      { command: 'turnOn', parameter: 'default', commandType: 'command' },
    ]);
    expect(buildCommands({ on: false })[0]!.command).toBe('turnOff');
    expect(buildCommands({ brightness: 50 })[0]).toMatchObject({ command: 'setBrightness', parameter: 50 });
    expect(buildCommands({ color: { hex: '#ff8000' } })[0]).toMatchObject({
      command: 'setColor',
      parameter: '255:128:0',
    });
    expect(buildCommands({ color: { temperatureK: 4000 } })[0]).toMatchObject({
      command: 'setColorTemperature',
      parameter: 4000,
    });
  });

  it('parseSwitchBotId extrae el deviceId', () => {
    expect(parseSwitchBotId('switchbot:AA1')).toBe('AA1');
    expect(parseSwitchBotId('AA1')).toBe('AA1');
    expect(parseSwitchBotId('switchbot:')).toBeNull();
  });
});
