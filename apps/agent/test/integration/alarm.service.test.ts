import type { IotDevice, IotManager } from '@krakenos/types';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { HomeEventBus } from '../../src/automations/event-bus.js';
import { AlarmPinError, AlarmService } from '../../src/modules/alarm/alarm.service.js';
import { buildTestApp, resetDb } from '../helpers/app.js';

/** IoT falso: registra setState y expone dispositivos con reachable configurable. */
class FakeIot implements IotManager {
  setCalls: { id: string; on?: boolean }[] = [];
  devices: IotDevice[] = [
    { id: 'siren', name: 'Sirena', kind: 'plug', room: null, reachable: true, on: false, brightness: null, color: null, readings: [] },
    // ⚠️ Este fixture llevaba un `reading:` suelto —el campo que US-244 sustituyó
    // por la lista `readings`— y nadie se enteró: `apps/agent/tsconfig.json` solo
    // incluye `src`, así que los tests del agente **tampoco** se typecheckean.
    { id: 'sensor-door', name: 'Puerta', kind: 'contact', room: null, reachable: true, on: null, brightness: null, color: null, readings: [{ metric: 'contact', value: 0, unit: '' }] },
  ];
  async listDevices() {
    return this.devices;
  }
  async getDevice(id: string) {
    return this.devices.find((d) => d.id === id) ?? null;
  }
  async setState(id: string, input: { on?: boolean }) {
    this.setCalls.push({ id, on: input.on });
    return this.devices.find((d) => d.id === id)!;
  }
}

describe('AlarmService (US-188)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp({ routes: false });
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetDb(app);
  });

  const build = (iot: FakeIot, now: () => number) => {
    const bus = new HomeEventBus();
    const service = new AlarmService(app, iot, bus, { now });
    return { service, bus };
  };

  it('armar → disparo de cámara → entry → triggered enciende la sirena y audita', async () => {
    const iot = new FakeIot();
    let clock = 0;
    const { service, bus } = build(iot, () => clock);
    const auditSpy = vi.spyOn(app, 'audit').mockImplementation(() => {});
    service.start();
    await service.setConfig({ sirenDeviceId: 'siren', cameraIds: ['cam-1'], exitDelaySec: 0, entryDelaySec: 10 });

    await service.armAlarm('away', 'ana@x');
    expect(service.getStateSync().phase).toBe('armed');

    // Movimiento de una cámara vigilada → entra en la cuenta de entrada.
    bus.publish({ type: 'motion-detected', cameraId: 'cam-1', cameraName: 'Entrada' });
    await vi.waitFor(() => expect(service.getStateSync().phase).toBe('entry'));

    // Vence la entrada → dispara: sirena ON + auditoría.
    clock = 11_000;
    await service.tick();
    expect(service.getStateSync().phase).toBe('triggered');
    expect(iot.setCalls).toContainEqual({ id: 'siren', on: true });
    expect(auditSpy).toHaveBeenCalledWith(expect.objectContaining({ action: 'alarm.triggered' }));

    service.stop();
    auditSpy.mockRestore();
  });

  /**
   * US-244 — la consecuencia grave que la historia cierra. Antes, la alarma
   * disparaba con **cualquier** `sensor-reading` cuyo valor cruzara 1, así que:
   *
   *  - un sensor de contacto no la disparaba nunca (z2m no producía la lectura), y
   *  - un canal Shelly metido en `sensorDeviceIds` la disparaba al encender una
   *    lámpara, porque su potencia pasaba de 0 W a 5 W.
   *
   * Ahora manda la **métrica**, no el número.
   */
  describe('qué dispara y qué no (US-244)', () => {
    const armada = async (iot: FakeIot) => {
      // Reloj fijo: estos tests comprueban qué entra en `entry` y qué no, no el
      // vencimiento de la cuenta atrás (eso ya lo cubre el test de arriba).
      const clock = 0;
      const { service, bus } = build(iot, () => clock);
      service.start();
      await service.setConfig({
        sirenDeviceId: 'siren',
        sensorDeviceIds: ['sensor-1'],
        exitDelaySec: 0,
        entryDelaySec: 10,
      });
      await service.armAlarm('away', 'ana@x');
      expect(service.getStateSync().phase).toBe('armed');
      return { service, bus };
    };

    it('una puerta que se abre la dispara', async () => {
      const { service, bus } = await armada(new FakeIot());
      bus.publish({
        type: 'sensor-reading',
        deviceId: 'sensor-1',
        metric: 'contact',
        value: 1,
        prevValue: 0,
      });
      await vi.waitFor(() => expect(service.getStateSync().phase).toBe('entry'));
      service.stop();
    });

    it('⚠️ un enchufe medidor NO la dispara al encender una lámpara', async () => {
      const { service, bus } = await armada(new FakeIot());
      // Mismo salto de 0 a 5 que antes la disparaba: lo único distinto es que la
      // métrica dice que es potencia, no un suceso.
      bus.publish({
        type: 'sensor-reading',
        deviceId: 'sensor-1',
        metric: 'power',
        value: 5,
        prevValue: 0,
      });
      // Se espera un poco: el fallo sería que cambiara de fase, no que tardara.
      await new Promise((r) => setTimeout(r, 30));
      expect(service.getStateSync().phase).toBe('armed');
      service.stop();
    });

    it('tampoco la disparan temperatura ni batería', async () => {
      const { service, bus } = await armada(new FakeIot());
      for (const metric of ['temperature', 'battery', 'humidity', 'illuminance'] as const) {
        bus.publish({ type: 'sensor-reading', deviceId: 'sensor-1', metric, value: 22, prevValue: 0 });
      }
      await new Promise((r) => setTimeout(r, 30));
      expect(service.getStateSync().phase).toBe('armed');
      service.stop();
    });

    it('humo y CO sí la disparan, y SIN retardo de entrada (US-245)', async () => {
      // El retardo de entrada es la gracia para entrar y teclear el PIN. Ante humo
      // no hay nada que desarmar: esos 30 s serían 30 s de sirena callada. Antes
      // pasaba por `entry` como una puerta cualquiera.
      for (const metric of ['smoke', 'co'] as const) {
        const { service, bus } = await armada(new FakeIot());
        bus.publish({ type: 'sensor-reading', deviceId: 'sensor-1', metric, value: 1, prevValue: 0 });
        await vi.waitFor(() => expect(service.getStateSync().phase).toBe('triggered'));
        service.stop();
      }
    });

    it('una puerta SÍ conserva su retardo de entrada', async () => {
      // El contrapunto del anterior: si se hubiera quitado el retardo para todos,
      // entrar en tu propia casa dispararía la alarma antes de llegar al teclado.
      const { service, bus } = await armada(new FakeIot());
      bus.publish({ type: 'sensor-reading', deviceId: 'sensor-1', metric: 'contact', value: 1, prevValue: 0 });
      await vi.waitFor(() => expect(service.getStateSync().phase).toBe('entry'));
      service.stop();
    });
  });

  /**
   * US-245 — el agujero que cierra la historia. Un detector de humo tenía que
   * cruzar **dos** puertas de un sistema **antirrobo** para que pasara algo:
   * estar en `sensorDeviceIds` y que la alarma estuviese armada. De noche, con la
   * casa llena y la alarma desarmada —que es cuando el CO mata— no producía nada:
   * ni aviso, ni registro, ni traza.
   */
  describe('humo y CO avisan SIEMPRE (US-245)', () => {
    /** Detector de humo que NO está en la lista de vigilancia de la alarma. */
    const conDetector = () => {
      const iot = new FakeIot();
      iot.devices.push({
        id: 'humo-cocina',
        name: 'Detector de la cocina',
        kind: 'smoke',
        room: null,
        reachable: true,
        on: null,
        brightness: null,
        color: null,
        readings: [{ metric: 'smoke', value: 0, unit: '' }],
      });
      return iot;
    };

    const avisos = (spy: ReturnType<typeof vi.spyOn>, accion: string) =>
      spy.mock.calls.filter((c) => (c[0] as { action: string }).action === accion);

    it('con la alarma DESARMADA y el detector fuera de la lista, avisa igual', async () => {
      const iot = conDetector();
      const { service, bus } = build(iot, () => 0);
      const auditSpy = vi.spyOn(app, 'audit').mockImplementation(() => {});
      service.start();
      // Config vacía a propósito: nada vigilado, nada armado. El caso real de
      // alguien que acaba de emparejar su detector y no ha tocado la alarma.
      await service.setConfig({ sensorDeviceIds: [], exitDelaySec: 0 });
      expect(service.getStateSync().phase).toBe('disarmed');

      bus.publish({ type: 'sensor-reading', deviceId: 'humo-cocina', metric: 'smoke', value: 1, prevValue: 0 });

      await vi.waitFor(() => expect(avisos(auditSpy, 'alarm.smoke')).toHaveLength(1));
      expect(avisos(auditSpy, 'alarm.smoke')[0]![0]).toMatchObject({
        detail: 'Humo detectado en Detector de la cocina',
      });
      // Y no toca la máquina de estados: la alarma sigue desarmada.
      expect(service.getStateSync().phase).toBe('disarmed');
      service.stop();
      auditSpy.mockRestore();
    });

    it('el CO tiene su propio evento (desactivar uno no apaga el otro)', async () => {
      const iot = conDetector();
      const { service, bus } = build(iot, () => 0);
      const auditSpy = vi.spyOn(app, 'audit').mockImplementation(() => {});
      service.start();
      await service.setConfig({ exitDelaySec: 0 });

      bus.publish({ type: 'sensor-reading', deviceId: 'humo-cocina', metric: 'co', value: 1, prevValue: 0 });

      await vi.waitFor(() => expect(avisos(auditSpy, 'alarm.co')).toHaveLength(1));
      expect(avisos(auditSpy, 'alarm.smoke')).toHaveLength(0);
      service.stop();
      auditSpy.mockRestore();
    });

    it('⚠️ una puerta abierta con la alarma desarmada NO avisa', async () => {
      // El contrapunto que impide que esto se convierta en «todo avisa siempre»:
      // una puerta que se abre con la casa llena es la vida normal.
      const iot = conDetector();
      const { service, bus } = build(iot, () => 0);
      const auditSpy = vi.spyOn(app, 'audit').mockImplementation(() => {});
      service.start();
      await service.setConfig({ exitDelaySec: 0 });

      bus.publish({ type: 'sensor-reading', deviceId: 'sensor-door', metric: 'contact', value: 1, prevValue: 0 });
      await new Promise((r) => setTimeout(r, 30));

      expect(auditSpy.mock.calls.filter((c) => String((c[0] as { action: string }).action).startsWith('alarm.'))).toHaveLength(0);
      service.stop();
      auditSpy.mockRestore();
    });

    it('un detector que oscila no genera un aviso por parpadeo', async () => {
      const iot = conDetector();
      let clock = 0;
      const { service, bus } = build(iot, () => clock);
      const auditSpy = vi.spyOn(app, 'audit').mockImplementation(() => {});
      service.start();
      await service.setConfig({ exitDelaySec: 0 });

      for (let i = 0; i < 4; i++) {
        clock += 10_000; // cuatro activaciones en 40 s, dentro de la ventana
        bus.publish({ type: 'sensor-reading', deviceId: 'humo-cocina', metric: 'smoke', value: 1, prevValue: 0 });
        await new Promise((r) => setTimeout(r, 10));
      }
      expect(avisos(auditSpy, 'alarm.smoke')).toHaveLength(1);

      clock += 5 * 60_000; // pasada la ventana de rearme, el riesgo sigue: vuelve a avisar
      bus.publish({ type: 'sensor-reading', deviceId: 'humo-cocina', metric: 'smoke', value: 1, prevValue: 0 });
      await vi.waitFor(() => expect(avisos(auditSpy, 'alarm.smoke')).toHaveLength(2));

      service.stop();
      auditSpy.mockRestore();
    });

    it('un detector de humo caído avisa aunque la alarma esté desarmada', async () => {
      // Mismo invariante que el aviso: un detector desconectado no avisa de nada,
      // y «no ha sonado» es indistinguible de «no hay humo» hasta que es tarde.
      const iot = conDetector();
      let clock = 0;
      const { service } = build(iot, () => clock);
      const auditSpy = vi.spyOn(app, 'audit').mockImplementation(() => {});
      await service.setConfig({ sensorDeviceIds: [], exitDelaySec: 0 });
      expect(service.getStateSync().phase).toBe('disarmed');

      iot.devices.find((d) => d.id === 'humo-cocina')!.reachable = false;
      await service.tick();
      // El reloj avanza más allá de la ventana del fail-safe: si no, el segundo
      // barrido ni siquiera lo ejecutaría y «no repite» pasaría solo.
      clock += 31_000;
      await service.tick();

      const faults = avisos(auditSpy, 'alarm.sensor_fault');
      expect(faults).toHaveLength(1);
      expect(faults[0]![0]).toMatchObject({ detail: expect.stringContaining('detector de humo/CO') });
      auditSpy.mockRestore();
    });

    it('el detector que vuelve y se vuelve a caer avisa otra vez', async () => {
      const iot = conDetector();
      let clock = 0;
      const { service } = build(iot, () => clock);
      const auditSpy = vi.spyOn(app, 'audit').mockImplementation(() => {});
      await service.setConfig({ exitDelaySec: 0 });
      const det = iot.devices.find((d) => d.id === 'humo-cocina')!;

      det.reachable = false;
      await service.tick();
      det.reachable = true;
      clock += 31_000;
      await service.tick();
      det.reachable = false;
      clock += 31_000;
      await service.tick();

      expect(avisos(auditSpy, 'alarm.sensor_fault')).toHaveLength(2);
      auditSpy.mockRestore();
    });
  });

  it('desarmar exige el PIN correcto (kid/guest no llegan aquí); apaga la sirena', async () => {
    const iot = new FakeIot();
    const { service } = build(iot, () => 0);
    vi.spyOn(app, 'audit').mockImplementation(() => {});
    await service.setConfig({ sirenDeviceId: 'siren', pin: '1234', exitDelaySec: 0, entryDelaySec: 0, cameraIds: ['cam-1'] });
    await service.armAlarm('away', 'ana@x');

    await expect(service.disarmAlarm('9999', 'ana@x')).rejects.toBeInstanceOf(AlarmPinError);
    await expect(service.disarmAlarm(undefined, 'ana@x')).rejects.toBeInstanceOf(AlarmPinError);

    const state = await service.disarmAlarm('1234', 'ana@x');
    expect(state.phase).toBe('disarmed');
    // Al desarmar tras estar activa, intenta apagar la sirena.
    expect(iot.setCalls).toContainEqual({ id: 'siren', on: false });
  });

  it('fail-safe: un sensor vigilado caído estando armada avisa una sola vez', async () => {
    const iot = new FakeIot();
    const { service } = build(iot, () => 0);
    const auditSpy = vi.spyOn(app, 'audit').mockImplementation(() => {});
    await service.setConfig({ sensorDeviceIds: ['sensor-door'], exitDelaySec: 0 });
    await service.armAlarm('away', 'ana@x');

    iot.devices.find((d) => d.id === 'sensor-door')!.reachable = false;
    await service.tick();
    await service.tick(); // segundo barrido: no repite el aviso
    const faults = auditSpy.mock.calls.filter((c) => c[0].action === 'alarm.sensor_fault');
    expect(faults).toHaveLength(1);
    expect(faults[0]![0].detail).toContain('Puerta');

    auditSpy.mockRestore();
  });

  it('el fail-safe no sondea el hardware en cada barrido de 1 s (US-229)', async () => {
    // El barrido corre cada segundo porque las cuentas atrás lo exigen, pero
    // consultaba el IoT en cada ciclo: 60 `listDevices()` por minuto solo desde
    // la alarma, de los ~71 que medía la auditoría (AUD3-18).
    const iot = new FakeIot();
    let clock = 0;
    const { service } = build(iot, () => clock);
    await service.setConfig({ sensorDeviceIds: ['sensor-door'], exitDelaySec: 0 });
    await service.armAlarm('away', 'ana@x');
    const listSpy = vi.spyOn(iot, 'listDevices');

    for (let i = 0; i < 10; i++) {
      clock += 1_000;
      await service.tick();
    }
    expect(listSpy).toHaveBeenCalledTimes(1);

    clock += 30_000; // pasada la ventana, vuelve a comprobar los sensores
    await service.tick();
    expect(listSpy).toHaveBeenCalledTimes(2);

    listSpy.mockRestore();
  });

  it('auto-armado: el hogar en modo away arma si autoArmAway está activo', async () => {
    const iot = new FakeIot();
    const { service, bus } = build(iot, () => 0);
    vi.spyOn(app, 'audit').mockImplementation(() => {});
    service.start();
    await service.setConfig({ autoArmAway: true, exitDelaySec: 0 });

    bus.publish({ type: 'mode-changed', mode: 'away', prevMode: 'home' });
    await vi.waitFor(() => expect(service.getStateSync().phase).toBe('armed'));
    expect(service.getStateSync().mode).toBe('away');
    service.stop();
  });

  it('el estado se persiste y se rehidrata (reconcile) al reiniciar', async () => {
    const iot = new FakeIot();
    const { service } = build(iot, () => 0);
    vi.spyOn(app, 'audit').mockImplementation(() => {});
    await service.setConfig({ exitDelaySec: 0 });
    await service.armAlarm('night', 'ana@x');

    const fresh = new AlarmService(app, iot, new HomeEventBus(), { now: () => 0 });
    expect(fresh.getStateSync().phase).toBe('disarmed');
    await fresh.reconcile();
    expect(fresh.getStateSync().phase).toBe('armed');
    expect(fresh.getStateSync().mode).toBe('night');
  });
});
