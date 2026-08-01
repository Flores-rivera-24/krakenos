import type { HomeEvent, IotDevice, IotManager } from '@krakenos/types';
import type { FastifyBaseLogger } from 'fastify';
import { createTickLoop, type TickLoop } from '../system/tick-loop.js';
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
  // Una transición **por métrica** (US-244). Antes solo se miraba `reading`, una
  // sola lectura: un sensor que reporta temperatura y contacto a la vez perdía la
  // segunda, y el evento no decía de qué magnitud hablaba.
  const antes = new Map(before.readings.map((r) => [r.metric, r.value]));
  for (const r of after.readings) {
    const prevValue = antes.get(r.metric) ?? null;
    if (r.value !== prevValue) {
      events.push({
        type: 'sensor-reading',
        deviceId: after.id,
        metric: r.metric,
        value: r.value,
        prevValue,
      });
    }
  }
  return events;
}

/** Firma estable de las lecturas para comparar sin depender del orden. */
function firmaDeLecturas(device: IotDevice): string {
  return [...device.readings]
    .map((r) => `${r.metric}=${r.value}`)
    .sort()
    .join('|');
}

/** ¿Cambió algo que la UI pinte? Comparación estable, sin sorpresas de orden. */
function cambio(before: IotDevice, after: IotDevice): boolean {
  return (
    before.on !== after.on ||
    before.brightness !== after.brightness ||
    before.reachable !== after.reachable ||
    before.color?.hex !== after.color?.hex ||
    before.color?.temperatureK !== after.color?.temperatureK ||
    firmaDeLecturas(before) !== firmaDeLecturas(after) ||
    (before.position ?? null) !== (after.position ?? null) ||
    (before.targetC ?? null) !== (after.targetC ?? null) ||
    (before.locked ?? null) !== (after.locked ?? null) ||
    (before.powerW ?? null) !== (after.powerW ?? null)
  );
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
  private loop: TickLoop | null = null;
  private baseline: Map<string, IotDevice> | null = null;
  /**
   * Sumidero de cambios observados **desde fuera** de la app (US-242). Los seis
   * emisores de `iot:device-updated` que había eran todos de origen interno, así
   * que encender un foco desde el interruptor de pared no llegaba a la UI hasta
   * recargar — justo el escenario que «sustituir a la app del fabricante» exige
   * que funcione. Inyectado para no acoplar el watcher a Socket.io.
   */
  private deviceSink: ((device: IotDevice) => void) | null = null;

  constructor(
    private readonly iot: IotManager,
    private readonly bus: HomeEventBus,
    private readonly log?: FastifyBaseLogger,
  ) {}

  /** Registra a quién avisar de un cambio observado (US-242). */
  setDeviceSink(sink: (device: IotDevice) => void): void {
    this.deviceSink = sink;
  }

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
      // El sumidero va aparte de las transiciones **a propósito**: el bus solo
      // modela encendido/apagado y lecturas, pero la UI también pinta brillo,
      // color y disponibilidad. Se avisa de cualquier cambio observable.
      const before = prev.get(device.id);
      if (this.deviceSink && before && cambio(before, device)) {
        this.deviceSink(device);
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

  start(intervalMs = 15_000): void {
    if (this.loop) return;
    this.loop = createTickLoop({
      intervalMs,
      immediate: true, // fija la línea base
      tick: () => this.tick(),
      onError: (err) =>
        this.log?.warn({ err }, '[automations] el sondeo IoT falló; se omite este ciclo'),
      onSkip: () =>
        this.log?.warn('[automations] el sondeo IoT anterior sigue en curso; se salta este ciclo'),
    });
    this.loop.start();
  }

  stop(): void {
    this.loop?.stop();
    this.loop = null;
  }
}
