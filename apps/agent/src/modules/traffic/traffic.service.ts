import type { HardwareDriver, TrafficSample } from '@krakenos/types';
import { TRAFFIC_ROOM } from '@krakenos/types';
import type { FastifyInstance } from 'fastify';

/** Nº de muestras retenidas en memoria (~2 min a 2 s/muestra). */
const MAX_HISTORY = 60;

/**
 * Muestrea el ancho de banda vía driver a intervalos y lo emite en tiempo real
 * por Socket.io, manteniendo un histórico corto para clientes que (re)conectan.
 */
export class TrafficService {
  private history: TrafficSample[] = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly app: FastifyInstance,
    private readonly driver: HardwareDriver,
    private readonly intervalMs = 2000,
  ) {}

  getHistory(): TrafficSample[] {
    return this.history;
  }

  /** Toma una muestra, la guarda en el histórico y la emite. */
  async sampleOnce(): Promise<TrafficSample> {
    const sample = await this.driver.getTrafficSample();
    this.history.push(sample);
    if (this.history.length > MAX_HISTORY) this.history.shift();
    this.app.io.to(TRAFFIC_ROOM).emit('traffic:sample', sample);
    return sample;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.sampleOnce(), this.intervalMs);
    // No mantener vivo el proceso solo por este intervalo.
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
