import type { HomeEvent, IotDevice, IotManager } from '@krakenos/types';
import type { FastifyBaseLogger } from 'fastify';
import type { HomeEventBus } from './event-bus.js';

/** Transiciones observables entre dos estados del mismo dispositivo. */
function transitions(before: IotDevice | undefined, after: IotDevice): HomeEvent[] {
  if (!before) return []; // sin estado previo conocido: no hay transición
  const events: HomeEvent[] = [];
  if (after.on !== null && before.on !== null && after.on !== before.on) {
    events.push(
      after.on ? { type: 'iot-on', deviceId: after.id } : { type: 'iot-off', deviceId: after.id },
    );
  }
  if (after.reading && after.reading.value !== (before.reading?.value ?? null)) {
    events.push({
      type: 'sensor-reading',
      deviceId: after.id,
      value: after.reading.value,
      prevValue: before.reading?.value ?? null,
    });
  }
  return events;
}

/**
 * Observador de estado IoT (US-167): sondea `listDevices()` periódicamente y
 * publica en el bus las **transiciones** (encendido/apagado, lectura de sensor
 * que cambia). Sondear —en vez de engancharse a cada sitio que hace `setState`—
 * es lo único que ve los cambios externos (un sensor de movimiento dispara en
 * el mundo real sin que KrakenOS haya hecho nada). El primer barrido solo fija
 * la línea base: no publica nada (mismo criterio que `prevTick` en horarios).
 */
export class IotWatcher {
  private timer: NodeJS.Timeout | null = null;
  private baseline: Map<string, IotDevice> | null = null;

  constructor(
    private readonly iot: IotManager,
    private readonly bus: HomeEventBus,
    private readonly log?: FastifyBaseLogger,
  ) {}

  /** Un barrido: difiere el snapshot actual contra la línea base y publica transiciones. */
  async tick(): Promise<void> {
    const devices = await this.iot.listDevices();
    const current = new Map(devices.map((d) => [d.id, d]));
    const prev = this.baseline;
    this.baseline = current;
    if (!prev) return; // primer barrido: fija la base

    for (const device of current.values()) {
      for (const event of transitions(prev.get(device.id), device)) {
        this.bus.publish(event);
      }
    }
  }

  /**
   * Registra un estado que el agente ACABA de aplicar (una acción de
   * automatización): actualiza la línea base —para que el siguiente sondeo no
   * re-publique la transición sin procedencia— y devuelve las transiciones
   * observadas, que el llamante publica con su `origin` (anti-bucle).
   */
  applyKnownState(device: IotDevice): HomeEvent[] {
    if (!this.baseline) return [];
    const events = transitions(this.baseline.get(device.id), device);
    this.baseline.set(device.id, device);
    return events;
  }

  private async tickCycle(): Promise<void> {
    try {
      await this.tick();
    } catch (err) {
      this.log?.warn({ err }, '[automations] el sondeo IoT falló; se omite este ciclo');
    }
  }

  start(intervalMs = 15_000): void {
    if (this.timer) return;
    void this.tickCycle(); // fija la línea base
    this.timer = setInterval(() => void this.tickCycle(), intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
