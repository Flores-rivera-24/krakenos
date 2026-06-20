import type {
  DeviceTrafficStats,
  HardwareDriver,
  TrafficBucket,
  TrafficRange,
  TrafficSample,
  TrafficStats,
} from '@krakenos/types';
import { TRAFFIC_ROOM } from '@krakenos/types';
import type { FastifyInstance } from 'fastify';

/** Nº de muestras retenidas en memoria (~2 min a 2 s/muestra). */
const MAX_HISTORY = 60;

/** Retención de los rollups persistidos: una semana (cubre el rango máximo). */
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** Duración de la ventana por rango, en milisegundos. */
const RANGE_MS: Record<TrafficRange, number> = {
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
};

/** Tamaño del bucket de agregación por rango, en milisegundos. */
const BUCKET_MS: Record<TrafficRange, number> = {
  hour: 60 * 1000, // 1 min  → 60 puntos
  day: 15 * 60 * 1000, // 15 min → 96 puntos
  week: 60 * 60 * 1000, // 1 hora → 168 puntos
};

/**
 * Muestrea el ancho de banda vía driver a intervalos y lo emite en tiempo real
 * por Socket.io, manteniendo un histórico corto en memoria para clientes que
 * (re)conectan. Además acumula las muestras y persiste un **rollup** periódico
 * (media del intervalo) en SQLite para estadísticas históricas (US-13).
 */
export class TrafficService {
  private history: TrafficSample[] = [];
  private timer: NodeJS.Timeout | null = null;
  private rollupTimer: NodeJS.Timeout | null = null;

  // Acumulador del rollup en curso.
  private sumRx = 0;
  private sumTx = 0;
  private count = 0;

  // Acumulador del rollup por dispositivo: mac → sumas + IP más reciente (US-46).
  private deviceAcc = new Map<string, { ip: string; sumRx: number; sumTx: number; count: number }>();

  constructor(
    private readonly app: FastifyInstance,
    private readonly driver: HardwareDriver,
    private readonly intervalMs = 2000,
    private readonly rollupMs = 60_000,
  ) {}

  getHistory(): TrafficSample[] {
    return this.history;
  }

  /** Toma una muestra, la guarda en el histórico/acumulador y la emite. */
  async sampleOnce(): Promise<TrafficSample> {
    const result = await this.driver.getTrafficSample();
    const sample: TrafficSample = {
      timestamp: new Date().toISOString(),
      rxBytesPerSec: result.wan.rxBytesPerSec,
      txBytesPerSec: result.wan.txBytesPerSec,
    };
    this.history.push(sample);
    if (this.history.length > MAX_HISTORY) this.history.shift();

    this.sumRx += sample.rxBytesPerSec;
    this.sumTx += sample.txBytesPerSec;
    this.count += 1;

    // Acumula el desglose por dispositivo, si el driver lo reporta (US-46).
    for (const d of result.devices ?? []) {
      const mac = d.mac.toLowerCase();
      const cur = this.deviceAcc.get(mac) ?? { ip: d.ip, sumRx: 0, sumTx: 0, count: 0 };
      cur.ip = d.ip || cur.ip;
      cur.sumRx += d.rxBytesPerSec;
      cur.sumTx += d.txBytesPerSec;
      cur.count += 1;
      this.deviceAcc.set(mac, cur);
    }

    this.app.io.to(TRAFFIC_ROOM).emit('traffic:sample', sample);
    return sample;
  }

  /**
   * Persiste la media de las muestras acumuladas como un rollup y poda los
   * rollups más antiguos que la retención. No hace nada si no hay muestras.
   */
  async flushRollup(): Promise<void> {
    if (this.count === 0) return;
    const rxBytesPerSec = this.sumRx / this.count;
    const txBytesPerSec = this.sumTx / this.count;
    this.sumRx = 0;
    this.sumTx = 0;
    this.count = 0;

    await this.app.prisma.trafficSample.create({
      data: { rxBytesPerSec, txBytesPerSec },
    });
    await this.app.prisma.trafficSample.deleteMany({
      where: { timestamp: { lt: new Date(Date.now() - RETENTION_MS) } },
    });

    // Rollup por dispositivo (US-46): una fila por MAC con su media del intervalo.
    const devices = [...this.deviceAcc.entries()];
    this.deviceAcc.clear();
    for (const [mac, acc] of devices) {
      if (acc.count === 0) continue;
      await this.app.prisma.deviceTrafficSample.create({
        data: { mac, rxBytesPerSec: acc.sumRx / acc.count, txBytesPerSec: acc.sumTx / acc.count },
      });
    }
    await this.app.prisma.deviceTrafficSample.deleteMany({
      where: { timestamp: { lt: new Date(Date.now() - RETENTION_MS) } },
    });
  }

  /**
   * Estadísticas históricas para una ventana: serie agregada en buckets
   * (media de tasa por bucket) y bytes totales estimados a partir de los
   * rollups persistidos.
   */
  async getStats(range: TrafficRange): Promise<TrafficStats> {
    const since = new Date(Date.now() - RANGE_MS[range]);
    const rows = await this.app.prisma.trafficSample.findMany({
      where: { timestamp: { gte: since } },
      orderBy: { timestamp: 'asc' },
    });

    const bucketMs = BUCKET_MS[range];
    const acc = new Map<number, { rx: number; tx: number; n: number }>();
    let totalRxBytes = 0;
    let totalTxBytes = 0;
    const rollupSeconds = this.rollupMs / 1000;

    for (const row of rows) {
      const bucketStart = Math.floor(row.timestamp.getTime() / bucketMs) * bucketMs;
      const cur = acc.get(bucketStart) ?? { rx: 0, tx: 0, n: 0 };
      cur.rx += row.rxBytesPerSec;
      cur.tx += row.txBytesPerSec;
      cur.n += 1;
      acc.set(bucketStart, cur);
      // Cada rollup representa ~rollupSeconds de tráfico a su tasa media.
      totalRxBytes += row.rxBytesPerSec * rollupSeconds;
      totalTxBytes += row.txBytesPerSec * rollupSeconds;
    }

    const buckets: TrafficBucket[] = [...acc.entries()]
      .sort(([a], [b]) => a - b)
      .map(([start, { rx, tx, n }]) => ({
        timestamp: new Date(start).toISOString(),
        rxBytesPerSec: rx / n,
        txBytesPerSec: tx / n,
      }));

    return { range, buckets, totalRxBytes, totalTxBytes };
  }

  /**
   * Tráfico histórico agregado por dispositivo en la ventana dada: serie en
   * buckets + totales estimados, combinado con `Device.label`/`ip` de Prisma.
   * Ordenado por descarga total descendente. (US-46)
   */
  async getDeviceStats(range: TrafficRange): Promise<DeviceTrafficStats[]> {
    const since = new Date(Date.now() - RANGE_MS[range]);
    const rows = await this.app.prisma.deviceTrafficSample.findMany({
      where: { timestamp: { gte: since } },
      orderBy: { timestamp: 'asc' },
    });
    if (rows.length === 0) return [];

    const byMac = new Map<string, typeof rows>();
    for (const row of rows) {
      const arr = byMac.get(row.mac) ?? [];
      arr.push(row);
      byMac.set(row.mac, arr);
    }

    // Nombre/IP del dispositivo desde el inventario (puede no existir la fila).
    const devices = await this.app.prisma.device.findMany({
      where: { mac: { in: [...byMac.keys()] } },
    });
    const deviceByMac = new Map(devices.map((d) => [d.mac, d]));

    const bucketMs = BUCKET_MS[range];
    const rollupSeconds = this.rollupMs / 1000;

    const stats: DeviceTrafficStats[] = [...byMac.entries()].map(([mac, samples]) => {
      const acc = new Map<number, { rx: number; tx: number; n: number }>();
      let rxTotal = 0;
      let txTotal = 0;
      for (const s of samples) {
        const bucketStart = Math.floor(s.timestamp.getTime() / bucketMs) * bucketMs;
        const cur = acc.get(bucketStart) ?? { rx: 0, tx: 0, n: 0 };
        cur.rx += s.rxBytesPerSec;
        cur.tx += s.txBytesPerSec;
        cur.n += 1;
        acc.set(bucketStart, cur);
        // Cada rollup representa ~rollupSeconds de tráfico a su tasa media.
        rxTotal += s.rxBytesPerSec * rollupSeconds;
        txTotal += s.txBytesPerSec * rollupSeconds;
      }
      const buckets: TrafficBucket[] = [...acc.entries()]
        .sort(([a], [b]) => a - b)
        .map(([start, { rx, tx, n }]) => ({
          timestamp: new Date(start).toISOString(),
          rxBytesPerSec: rx / n,
          txBytesPerSec: tx / n,
        }));
      const dev = deviceByMac.get(mac);
      return {
        mac,
        ip: dev?.ip ?? '',
        label: dev?.label ?? null,
        rxTotal,
        txTotal,
        samples: buckets,
      };
    });

    stats.sort((a, b) => b.rxTotal - a.rxTotal);
    return stats;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.sampleOnce(), this.intervalMs);
    this.rollupTimer = setInterval(() => void this.flushRollup(), this.rollupMs);
    // No mantener vivo el proceso solo por estos intervalos.
    this.timer.unref();
    this.rollupTimer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.rollupTimer) {
      clearInterval(this.rollupTimer);
      this.rollupTimer = null;
    }
  }
}
