import { describe, expect, it } from 'vitest';
import {
  esAdoptable,
  fusionaPrefill,
  politicaDe,
  yaConfigurado,
} from '../../src/discovery/adopt.js';
import { matchFingerprints } from '../../src/discovery/fingerprints.js';
import { resolveIotConfig } from '../../src/integrations/factory-config.js';
import { INTEGRATION_SCHEMA } from '../../src/integrations/schema.js';

/**
 * Adopción de un toque (US-249): decidir si una sugerencia se puede dar de alta
 * sin preguntar nada, y fundirla con lo ya configurado **sin pisarlo**.
 */

const campos = (kind: string) => INTEGRATION_SCHEMA.iot[kind]?.fields ?? [];

describe('esAdoptable', () => {
  it('sí cuando el prefill cubre lo obligatorio y nada obligatorio es secreto', () => {
    expect(esAdoptable({ devices: '[{"ip":"192.168.1.80"}]' }, campos('shelly'))).toBe(true);
    expect(esAdoptable({ brokerUrl: 'mqtt://192.168.1.10:1883' }, campos('mqtt'))).toBe(true);
    expect(esAdoptable({ brokerUrl: 'mqtt://192.168.1.10:1883' }, campos('zigbee'))).toBe(true);
    // Kasa no tiene ningún campo obligatorio: basta con la IP descubierta.
    expect(esAdoptable({ tapoDeviceIps: '192.168.1.61' }, campos('kasa'))).toBe(true);
  });

  it('⚠️ NO para Hue: su `appKey` es un secreto obligatorio', () => {
    // Sale de pulsar el botón físico del bridge y un prefill nunca lleva secretos,
    // así que «un toque» habría sido un botón que falla.
    expect(esAdoptable({ bridgeUrl: 'http://192.168.1.2' }, campos('hue'))).toBe(false);
  });

  it('no sin prefill: una sugerencia sin datos abre el asistente', () => {
    // La cámara ONVIF y el ESPHome descubierto: se sabe qué integración es, pero
    // no lo que hace falta para darla de alta.
    expect(esAdoptable({}, campos('mqtt'))).toBe(false);
  });

  it('un campo obligatorio ya guardado cuenta como cubierto', () => {
    // Segundo aparato de un backend que ya existe: su broker ya está configurado.
    expect(esAdoptable({ otro: 'x' }, campos('zigbee'), { brokerUrl: 'mqtt://x:1883' })).toBe(true);
    expect(esAdoptable({ otro: 'x' }, campos('zigbee'), {})).toBe(false);
  });
});

describe('fusionaPrefill', () => {
  it('⚠️ AÑADE el segundo aparato en vez de reemplazar al primero', () => {
    // Es el caso que da nombre a la historia: adoptar un Shelly cuando ya hay otro
    // tiene que dejar LOS DOS.
    const yaHay = { 'shelly.devices': '[{"ip":"192.168.1.80","gen":2}]' };
    const salida = fusionaPrefill(
      'shelly',
      { devices: '[{"ip":"192.168.1.81","gen":1}]' },
      yaHay,
      true,
    );
    expect(JSON.parse(String(salida['shelly.devices']))).toEqual([
      { ip: '192.168.1.80', gen: 2 },
      { ip: '192.168.1.81', gen: 1 },
    ]);
  });

  it('no duplica un aparato que ya estaba', () => {
    const yaHay = { 'shelly.devices': '[{"ip":"192.168.1.80"}]' };
    const salida = fusionaPrefill('shelly', { devices: '[{"ip":"192.168.1.80"}]' }, yaHay, true);
    expect(salida).toEqual({});
    const csv = { 'kasa.tapoDeviceIps': '192.168.1.61' };
    expect(fusionaPrefill('kasa', { tapoDeviceIps: '192.168.1.61' }, csv, true)).toEqual({});
  });

  it('añade a una lista CSV conservando lo anterior', () => {
    const salida = fusionaPrefill(
      'kasa',
      { tapoDeviceIps: '192.168.1.62' },
      { 'kasa.tapoDeviceIps': '192.168.1.61' },
      true,
    );
    expect(salida['kasa.tapoDeviceIps']).toBe('192.168.1.61,192.168.1.62');
  });

  it('⚠️ un escalar ya configurado NO se pisa', () => {
    // El usuario pudo ajustar su broker a mano (puerto, host distinto): una
    // sugerencia no puede sobrescribirlo.
    const yaHay = { 'zigbee.brokerUrl': 'mqtt://mi-broker.lan:8883' };
    expect(fusionaPrefill('zigbee', { brokerUrl: 'mqtt://192.168.1.10:1883' }, yaHay, true)).toEqual(
      {},
    );
    // Pero si no había nada, se pone.
    expect(fusionaPrefill('zigbee', { brokerUrl: 'mqtt://192.168.1.10:1883' }, {}, true)).toEqual({
      'zigbee.brokerUrl': 'mqtt://192.168.1.10:1883',
    });
  });

  it('sin namespacing para los dominios que no son `iot`', () => {
    expect(fusionaPrefill('rtsp', { transport: 'tcp' }, {}, false)).toEqual({ transport: 'tcp' });
  });

  it('una lista guardada corrupta no rompe la fusión', () => {
    const salida = fusionaPrefill('shelly', { devices: '[{"ip":"192.168.1.81"}]' }, { 'shelly.devices': '{roto' }, true);
    expect(JSON.parse(String(salida['shelly.devices']))).toEqual([{ ip: '192.168.1.81' }]);
  });
});

describe('yaConfigurado', () => {
  it('oculta el aparato que la config demuestra que ya está', () => {
    expect(
      yaConfigurado('shelly', '192.168.1.80', { devices: '' }, { 'shelly.devices': '[{"ip":"192.168.1.80"}]' }, true),
    ).toBe(true);
    expect(
      yaConfigurado('kasa', '192.168.1.61', { tapoDeviceIps: '' }, { 'kasa.tapoDeviceIps': '192.168.1.60,192.168.1.61' }, true),
    ).toBe(true);
    expect(
      yaConfigurado('hue', '192.168.1.2', { bridgeUrl: '' }, { 'hue.bridgeUrl': 'http://192.168.1.2' }, true),
    ).toBe(true);
  });

  it('⚠️ el SEGUNDO aparato del mismo backend sigue viéndose', () => {
    // El fallo que cierra la historia: antes bastaba con que el `kind` estuviera
    // configurado para no volver a sugerir NINGUNO más, nunca.
    expect(
      yaConfigurado('shelly', '192.168.1.81', { devices: '' }, { 'shelly.devices': '[{"ip":"192.168.1.80"}]' }, true),
    ).toBe(false);
    expect(
      yaConfigurado('kasa', '192.168.1.99', { tapoDeviceIps: '' }, { 'kasa.tapoDeviceIps': '192.168.1.61' }, true),
    ).toBe(false);
  });

  it('lo que no se puede comprobar NO se oculta', () => {
    // Una cámara ONVIF se da de alta en otra pantalla, así que la config de
    // integración no puede probar nada. Se enseña y el usuario la descarta (y el
    // descarte sí se persiste): enseñar de más se arregla con un clic, ocultar de
    // menos no se arregla nunca porque no se ve.
    expect(yaConfigurado('rtsp', '192.168.1.50', {}, { transport: 'tcp' }, false)).toBe(false);
  });
});

describe('gate: el prefill de cada huella es config VÁLIDA para su backend', () => {
  /**
   * ⚠️ Es el test que habría cazado el fallo de US-249: la huella de Shelly
   * precargaba la IP a secas en un campo que el backend parsea como lista JSON, y
   * `parseShellyDevices` se lo tragaba en un `catch` → el usuario seguía la
   * sugerencia, guardaba y se quedaba con **cero aparatos** y ningún error. No se
   * comprueba «tiene la forma que creo», sino que se pasa por el **resolver real**.
   */
  const registros = [
    { type: 'mdns' as const, service: '_shelly._tcp.local', name: 'shellyplus1-a1._shelly._tcp.local', ip: '192.168.1.80', port: 80, txt: { gen: '2' } },
    { type: 'mdns' as const, service: '_mqtt._tcp.local', name: 'mosquitto._mqtt._tcp.local', ip: '192.168.1.10', port: 1883, txt: {} },
    { type: 'mdns' as const, service: '_http._tcp.local', name: 'Tapo P110._http._tcp.local', ip: '192.168.1.61', port: 80, txt: {} },
    { type: 'mdns' as const, service: '_hue._tcp.local', name: 'Hue Bridge._hue._tcp.local', ip: '192.168.1.2', port: 443, txt: {} },
  ];

  it('cada prefill IoT llega íntegro al config del backend', () => {
    const matches = matchFingerprints(registros).filter((m) => m.domain === 'iot');
    expect(matches.length).toBeGreaterThanOrEqual(4); // guard: si no casa nada, esto no prueba nada

    for (const match of matches) {
      if (Object.keys(match.prefill).length === 0) continue;
      const values = Object.fromEntries(
        Object.entries(match.prefill).map(([k, v]) => [`${match.kind}.${k}`, v]),
      );
      const cfg = resolveIotConfig({ kind: match.kind, values, enabled: true });

      switch (match.kind) {
        case 'shelly':
          // Lo que se rompía: aquí salía `[]` con la IP en el prefill.
          expect(cfg.shelly?.devices, 'shelly').toEqual([
            expect.objectContaining({ ip: match.ip, gen: 2 }),
          ]);
          break;
        case 'kasa':
          expect(cfg.kasa?.tapoIps, 'kasa').toContain(match.ip);
          break;
        case 'zigbee':
          expect(cfg.zigbee?.url, 'zigbee').toContain(match.ip);
          break;
        case 'mqtt':
          expect(cfg.mqtt?.url, 'mqtt').toContain(match.ip);
          break;
        case 'hue':
          expect(cfg.hue?.url, 'hue').toContain(match.ip);
          break;
        default:
          throw new Error(`Huella IoT sin comprobación en el gate: ${match.kind}`);
      }
    }
  });

  it('toda clave de prefill tiene una política de fusión declarada o cae al defecto seguro', () => {
    for (const match of matchFingerprints(registros)) {
      for (const clave of Object.keys(match.prefill)) {
        expect(['escalar', 'csv', 'lista-json']).toContain(politicaDe(match.kind, clave));
      }
    }
  });
});
