import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { IotDevice, IotManager } from '@krakenos/types';
import { CONTROLLABLE_IOT_KINDS, isControllableKind } from '@krakenos/types';
import { describe, expect, it } from 'vitest';
import { CompositeIotManager } from '../../src/iot/composite.iot.js';
import { endpointTypeFor } from '../../src/iot/matter-bridge/mapping.js';
import { buildDiscoveryConfigs, exposureFor } from '../../src/modules/interop/ha-discovery.js';
import { updateIotSchema } from '../../src/modules/iot/iot.schemas.js';

/**
 * GATE de la política de cerraduras (US-246, `docs/adr-cerraduras.md`).
 *
 * La decisión es «una cerradura se lee y se puede cerrar; **abrir no se
 * construye**», y no se sostiene con el documento: se sostiene comprobando que la
 * superficie de desbloqueo **no existe** en ninguna de las vías por las que una
 * orden puede llegar a un aparato. Enumerarlas a mano en un comentario es justo
 * lo que ya salió mal con las peticiones salientes —se contaron mal en dos
 * auditorías seguidas—, así que las que se pueden derivar del código se derivan.
 *
 * Si este fichero se pone rojo, la pregunta no es «cómo lo arreglo»: es si se
 * está tomando la decisión que el ADR dejó pendiente. Cambiarlo **es** tomarla.
 */
describe('política de cerraduras: se leen y se cierran, no se abren (US-246)', () => {
  const cerradura: IotDevice = {
    id: 'cer-1',
    name: 'Puerta de la calle',
    kind: 'lock',
    room: null,
    reachable: true,
    on: null,
    brightness: null,
    color: null,
    readings: [],
    locked: true,
  };

  it('el contrato no considera controlable una cerradura', () => {
    expect(isControllableKind('lock')).toBe(false);
    expect([...CONTROLLABLE_IOT_KINDS]).not.toContain('lock');
  });

  it('el borde HTTP no admite un campo de cerradura', () => {
    // `additionalProperties: false` lo impide, pero se comprueba explícitamente:
    // añadir la propiedad sería un cambio de una línea en el schema.
    const props = Object.keys(updateIotSchema.body.properties);
    expect(props).not.toContain('locked');
    expect(props).not.toContain('unlock');
    expect(updateIotSchema.body.additionalProperties).toBe(false);
  });

  it('no hay ninguna ruta de desbloqueo en el módulo IoT', () => {
    const dir = join(process.cwd(), 'src/modules/iot');
    const fuentes = readdirSync(dir)
      .filter((f) => f.endsWith('.ts'))
      .map((f) => readFileSync(join(dir, f), 'utf8'));
    expect(fuentes.length).toBeGreaterThan(2); // guard: si no lee nada, no prueba nada
    for (const src of fuentes) {
      expect(src).not.toMatch(/['"`]\/devices\/:id\/unlock/);
      expect(src).not.toMatch(/['"`]\/unlock/);
    }
  });

  /**
   * El guard vive en el **composite**, que desde US-243 envuelve a todo manager
   * —también cuando hay uno solo—, así que es el único punto por el que pasan las
   * órdenes de rutas, escenas, horarios, automatizaciones y control entrante.
   *
   * ⚠️ Este test empezó siendo un barrido de los nueve backends buscando quién
   * validaba y quién no, y **falló dos veces seguidas midiendo otra cosa**:
   * primero aceptaba un `import` huérfano como si fuera el guard, y después
   * saltaba entero el backend de zigbee2mqtt porque adivinaba mal el nombre de su
   * parser. La lección es de diseño, no de expresión regular: un invariante que
   * hay que comprobar en nueve sitios se comprueba mal; se pone en el sitio por
   * el que pasan los nueve.
   */
  it('el composite rechaza una orden sobre una cerradura, sea cual sea el backend', async () => {
    const backend: IotManager = {
      listDevices: async () => [cerradura],
      getDevice: async (id) => (id === 'cer-1' ? cerradura : null),
      setState: async () => {
        throw new Error('el backend NO debería recibir la orden');
      },
    };
    const composite = new CompositeIotManager([{ prefix: 'z2m', manager: backend }]);

    await expect(composite.setState('z2m:cer-1', { on: false })).rejects.toMatchObject({
      code: 'IOT_NOT_CONTROLLABLE',
    });
  });

  it('y deja pasar lo que sí es controlable', async () => {
    const foco: IotDevice = { ...cerradura, id: 'luz-1', kind: 'light', on: false, locked: null };
    let recibida = false;
    const backend: IotManager = {
      listDevices: async () => [foco],
      getDevice: async () => foco,
      setState: async () => {
        recibida = true;
        return { ...foco, on: true };
      },
    };
    const composite = new CompositeIotManager([{ prefix: 'hue', manager: backend }]);

    await composite.setState('hue:luz-1', { on: true });
    expect(recibida).toBe(true);
  });

  it('un fallo de lectura NO bloquea el control (no se niega la casa por un bridge lento)', async () => {
    const foco: IotDevice = { ...cerradura, id: 'luz-1', kind: 'light', on: false, locked: null };
    const backend: IotManager = {
      listDevices: async () => [foco],
      getDevice: async () => {
        throw new Error('bridge sin responder');
      },
      setState: async () => ({ ...foco, on: true }),
    };
    const composite = new CompositeIotManager([{ prefix: 'hue', manager: backend }]);

    await expect(composite.setState('hue:luz-1', { on: true })).resolves.toMatchObject({ on: true });
  });

  it('a Home Assistant se publica de solo lectura, incluso con el control activo', () => {
    const exp = exposureFor(cerradura, true);
    expect(exp).toEqual({ component: 'binary_sensor', deviceClass: 'lock' });

    const msgs = buildDiscoveryConfigs(
      {
        iot: [cerradura],
        energy: null,
        devicesOnline: 0,
        homeMode: null,
        alarmPhase: null,
        blockedDevices: [],
        roomSignals: [],
      },
      'casa',
      { iot: true, pause: true },
    );
    for (const m of msgs) {
      const payload = JSON.parse(m.payload || '{}') as Record<string, unknown>;
      expect(payload.command_topic, `${m.topic} lleva command_topic`).toBeUndefined();
    }
    // Y nunca como entidad `lock` de HA, que sí es controlable por definición.
    expect(msgs.some((m) => m.topic.startsWith('homeassistant/lock/'))).toBe(false);
  });

  it('el puente Matter no la expone a los asistentes de voz', () => {
    // Un asistente de voz oye a cualquiera que grite desde la ventana.
    expect(endpointTypeFor(cerradura)).toBeNull();
  });

  it('las automatizaciones no tienen una acción de cerradura', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/modules/automations/automations.schemas.ts'),
      'utf8',
    );
    expect(src.length).toBeGreaterThan(100); // guard
    expect(src).not.toMatch(/['"]iot-lock['"]|['"]iot-unlock['"]|locked:/);
  });
});
