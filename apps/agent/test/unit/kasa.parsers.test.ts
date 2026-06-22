import { describe, expect, it } from 'vitest';
import {
  buildKasaLightState,
  buildKasaRelay,
  buildTapoSetColor,
  buildTapoSetOn,
  deframeKasaTcp,
  frameKasaTcp,
  hexToHsv,
  hsvToHex,
  kasaDecrypt,
  kasaEncrypt,
  kasaToIotDevice,
  parseKasaSysinfo,
  parseTapoDeviceInfo,
  tapoToIotDevice,
} from '../../src/iot/kasa.parsers.js';

describe('kasa.parsers', () => {
  it('kasaEncrypt/kasaDecrypt es un round-trip (XOR autokey) y no es texto plano', () => {
    const text = '{"system":{"get_sysinfo":{}}}';
    const enc = kasaEncrypt(text);
    expect(enc.toString('utf8')).not.toBe(text); // está cifrado
    expect(kasaDecrypt(enc)).toBe(text);
    // El primer byte cifrado es char ^ 0xAB.
    expect(enc[0]).toBe(text.charCodeAt(0) ^ 0xab);
  });

  it('frameKasaTcp añade cabecera de longitud BE y deframeKasaTcp la revierte', () => {
    const text = '{"a":1}';
    const framed = frameKasaTcp(text);
    expect(framed.readUInt32BE(0)).toBe(framed.length - 4);
    expect(deframeKasaTcp(framed)).toBe(text);
  });

  it('parseKasaSysinfo mapea un enchufe (relay_state) a IotDevice plug', () => {
    const sysinfo = {
      system: { get_sysinfo: { alias: 'Cafetera', mic_type: 'IOT.SMARTPLUGSWITCH', relay_state: 1 } },
    };
    const dev = kasaToIotDevice(parseKasaSysinfo('192.168.1.60', sysinfo)!);
    expect(dev).toMatchObject({ id: 'kasa:192.168.1.60', name: 'Cafetera', kind: 'plug', on: true, brightness: null, color: null });
  });

  it('parseKasaSysinfo mapea una bombilla de color (light_state) a IotDevice light', () => {
    const sysinfo = {
      system: {
        get_sysinfo: {
          alias: 'Luz salón',
          mic_type: 'IOT.SMARTBULB',
          is_color: 1,
          light_state: { on_off: 1, brightness: 60, color_temp: 0, hue: 120, saturation: 100 },
        },
      },
    };
    const dev = kasaToIotDevice(parseKasaSysinfo('192.168.1.61', sysinfo)!);
    expect(dev).toMatchObject({ id: 'kasa:192.168.1.61', kind: 'light', on: true, brightness: 60 });
    expect(dev.color?.hex).toBe('#00ff00'); // hue 120, sat 100 → verde
  });

  it('buildKasaRelay y buildKasaLightState generan el JSON de comando correcto', () => {
    expect(JSON.parse(buildKasaRelay(true))).toEqual({ system: { set_relay_state: { state: 1 } } });
    const light = JSON.parse(buildKasaLightState({ on: true, brightness: 40, colorTemp: 2700 }));
    expect(light['smartlife.iot.smartbulb.lightingservice'].transition_light_state).toMatchObject({
      on_off: 1,
      brightness: 40,
      color_temp: 2700,
    });
  });

  it('parseTapoDeviceInfo decodifica el nickname base64 y mapea estado', () => {
    const nickname = Buffer.from('Enchufe TV').toString('base64');
    const info = { result: { model: 'P115', nickname, device_on: false } };
    const dev = tapoToIotDevice(parseTapoDeviceInfo('192.168.1.70', info));
    expect(dev).toMatchObject({ id: 'tapo:192.168.1.70', name: 'Enchufe TV', kind: 'plug', on: false });
  });

  it('buildTapoSetOn/Color generan método set_device_info con sus params', () => {
    expect(buildTapoSetOn(true)).toEqual({ method: 'set_device_info', params: { device_on: true } });
    expect(buildTapoSetColor({ colorTempK: 4000 })).toEqual({
      method: 'set_device_info',
      params: { color_temp: 4000 },
    });
  });

  it('hsvToHex/hexToHsv son consistentes para colores primarios', () => {
    expect(hsvToHex(0, 100, 100)).toBe('#ff0000');
    expect(hsvToHex(240, 100, 100)).toBe('#0000ff');
    expect(hexToHsv('#ff0000')).toMatchObject({ hue: 0, saturation: 100 });
    expect(hexToHsv('#0000ff')).toMatchObject({ hue: 240, saturation: 100 });
  });
});
