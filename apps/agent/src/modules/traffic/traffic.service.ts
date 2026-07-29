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
import { DAY_MS, DEVICE_TRAFFIC_RETENTION_DAYS, retentionDays } from '../../config/retention.js';
import { asNumber } from '../../db/sql-aggregate.js';
import { normalizeTrafficSample } from './normalize.js';
import { createTickLoop, type TickLoop } from '../../system/tick-loop.js';

/** Nº de muestras retenidas en memoria (~2 min a 2 s/muestra). */
const MAX_HISTORY = 60;

/** Retención por defecto de los rollups (días) si el ajuste no existe. Cubre el rango
 *  máximo (mes, US-113); ajustable con `trafficRetentionDays`. */
const DEFAULT_TRAFFIC_RETENTION_DAYS = 30;

/** Duración de la ventana por rango, en milisegundos. */
const RANGE_MS: Record<TrafficRange, number> = {
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
};

/** Tamaño del bucket de agregación por rango, en milisegundos. */
const BUCKET_MS: Record<TrafficRange, number> = {
  hour: 60 * 1000, // 1 min  → 60 puntos
  day: 15 * 60 * 1000, // 15 min → 96 puntos
  week: 60 * 60 * 1000, // 1 hora → 168 puntos
  month: 24 * 60 * 60 * 1000, // 1 día → 30 puntos
};

/**
 * Muestrea el ancho de banda vía driver a intervalos y lo emite en tiempo real
 * por Socket.io, manteniendo un histórico corto en memoria para clientes que
 * (re)conectan. Además acumula las muestras y persiste un **rollup** periódico
 * (media del intervalo) en SQLite para estadísticas históricas (US-13).
 */
export class TrafficService {
  private history: TrafficSample[] = [];
  private loop: TickLoop | null = null;
  private rollupLoop: TickLoop | null = null;

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
    // Saneado en la frontera del driver: forma de WAN inválida → lanza (US-98).
    const result = normalizeTrafficSample(await this.driver.getTrafficSample());
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

    // Retención configurable (US-102): antes era una constante de 7 días y el
    // ajuste `trafficRetentionDays` no se leía. Ahora lo respeta (acotado).
    const days = await retentionDays(
      this.app.prisma,
      'trafficRetentionDays',
      DEFAULT_TRAFFIC_RETENTION_DAYS,
    );
    const cutoff = new Date(Date.now() - days * DAY_MS);

    await this.app.prisma.trafficSample.create({
      data: { rxBytesPerSec, txBytesPerSec },
    });
    await this.app.prisma.trafficSample.deleteMany({
      where: { timestamp: { lt: cutoff } },
    });

    // Rollup por dispositivo (US-46): una fila por MAC con su media del intervalo.
    // `createMany` en vez de N `create` (US-228): eran N transacciones —y N fsync—
    // por minuto, que en una microSD es el grueso del coste de I/O del agente.
    const devices = [...this.deviceAcc.entries()];
    this.deviceAcc.clear();
    const deviceRows = devices
      .filter(([, acc]) => acc.count > 0)
      .map(([mac, acc]) => ({
        mac,
        rxBytesPerSec: acc.sumRx / acc.count,
        txBytesPerSec: acc.sumTx / acc.count,
      }));
    if (deviceRows.length > 0) {
      await this.app.prisma.deviceTrafficSample.createMany({ data: deviceRows });
    }
    // El rango consultable per-device es como mucho 7 d (`traffic.schemas.ts`), así
    // que guardar 30 como la serie del hogar dejaba el 77 % de la tabla más grande
    // en filas muertas e inconsultables (AUD3-12). Retención propia y honesta.
    const deviceCutoff = new Date(
      Date.now() - Math.min(days, DEVICE_TRAFFIC_RETENTION_DAYS) * DAY_MS,
    );
    await this.app.prisma.deviceTrafficSample.deleteMany({
      where: { timestamp: { lt: deviceCutoff } },
    });
  }

  /**
   * Estadísticas históricas para una ventana: serie agregada en buckets
   * (media de tasa por bucket) y bytes totales estimados a partir de los
   * rollups persistidos.
   */
  async getStats(range: TrafficRange): Promise<TrafficStats> {
    const sinceMs = Date.now() - RANGE_MS[range];
    const bucketMs = BUCKET_MS[range];
    const rollupSeconds = this.rollupMs / 1000;

    // Agregado en SQL (US-228): `range=month` traía 43.200 filas para pintar 30
    // puntos. Ver `db/sql-aggregate.ts` para el porqué del bucket aritmético.
    const rows = await this.app.prisma.$queryRaw<
      { bucket: number | bigint; avgRx: number; avgTx: number; sumRx: number; sumTx: number }[]
    >`
      SELECT (timestamp / ${bucketMs}) * ${bucketMs} AS bucket,
             AVG(rxBytesPerSec) AS avgRx,
             AVG(txBytesPerSec) AS avgTx,
             SUM(rxBytesPerSec) AS sumRx,
             SUM(txBytesPerSec) AS sumTx
      FROM TrafficSample
      WHERE timestamp >= ${sinceMs}
      GROUP BY bucket
      ORDER BY bucket ASC`;

    let totalRxBytes = 0;
    let totalTxBytes = 0;
    const buckets: TrafficBucket[] = rows.map((row) => {
      // Cada rollup representa ~rollupSeconds de tráfico a su tasa media.
      totalRxBytes += asNumber(row.sumRx) * rollupSeconds;
      totalTxBytes += asNumber(row.sumTx) * rollupSeconds;
      return {
        timestamp: new Date(asNumber(row.bucket)).toISOString(),
        rxBytesPerSec: asNumber(row.avgRx),
        txBytesPerSec: asNumber(row.avgTx),
      };
    });

    return { range, buckets, totalRxBytes, totalTxBytes };
  }

  /**
   * Tráfico histórico agregado por dispositivo en la ventana dada: serie en
   * buckets + totales estimados, combinado con `Device.label`/`ip` de Prisma.
   * Ordenado por descarga total descendente. (US-46)
   */
  async getDeviceStats(range: TrafficRange): Promise<DeviceTrafficStats[]> {
    const sinceMs = Date.now() - RANGE_MS[range];
    const bucketMs = BUCKET_MS[range];
    const rollupSeconds = this.rollupMs / 1000;

    // Agregado en SQL (US-228): con 40 aparatos, `range=week` materializaba ~403.000
    // filas en JS; ahora salen `macs × buckets` (~280).
    const rows = await this.app.prisma.$queryRaw<
      {
        mac: string;
        bucket: number | bigint;
        avgRx: number;
        avgTx: number;
        sumRx: number;
        sumTx: number;
      }[]
    >`
      SELECT mac,
             (timestamp / ${bucketMs}) * ${bucketMs} AS bucket,
             AVG(rxBytesPerSec) AS avgRx,
             AVG(txBytesPerSec) AS avgTx,
             SUM(rxBytesPerSec) AS sumRx,
             SUM(txBytesPerSec) AS sumTx
      FROM DeviceTrafficSample
      WHERE timestamp >= ${sinceMs}
      GROUP BY mac, bucket
      ORDER BY mac ASC, bucket ASC`;
    if (rows.length === 0) return [];

    interface Acc {
      rxTotal: number;
      txTotal: number;
      samples: TrafficBucket[];
    }
    const byMac = new Map<string, Acc>();
    for (const row of rows) {
      const acc = byMac.get(row.mac) ?? { rxTotal: 0, txTotal: 0, samples: [] };
      // Cada rollup representa ~rollupSeconds de tráfico a su tasa media.
      acc.rxTotal += asNumber(row.sumRx) * rollupSeconds;
      acc.txTotal += asNumber(row.sumTx) * rollupSeconds;
      acc.samples.push({
        timestamp: new Date(asNumber(row.bucket)).toISOString(),
        rxBytesPerSec: asNumber(row.avgRx),
        txBytesPerSec: asNumber(row.avgTx),
      });
      byMac.set(row.mac, acc);
    }

    // Nombre/IP del dispositivo desde el inventario (puede no existir la fila).
    const devices = await this.app.prisma.device.findMany({
      where: { mac: { in: [...byMac.keys()] } },
    });
    const deviceByMac = new Map(devices.map((d) => [d.mac, d]));

    const stats: DeviceTrafficStats[] = [...byMac.entries()].map(([mac, acc]) => {
      const dev = deviceByMac.get(mac);
      return {
        mac,
        ip: dev?.ip ?? '',
        label: dev?.label ?? null,
        rxTotal: acc.rxTotal,
        txTotal: acc.txTotal,
        samples: acc.samples,
      };
    });

    stats.sort((a, b) => b.rxTotal - a.rxTotal);
    return stats;
  }

  /**
   * Toma una muestra **sin propagar errores**: para el timer fire-and-forget. Si
   * el driver falla (caído, timeout, `getTrafficSample` malformado) lo registra y
   * omite el ciclo en vez de dejar una promesa rechazada sin gestionar —que, sin
   * handler global de `unhandledRejection`, tumbaría el agente cada 2 s.
   */
  async sampleCycle(): Promise<void> {
    try {
      await this.sampleOnce();
    } catch (err) {
      this.app.log.error({ err }, '[traffic] el muestreo falló; se omite este ciclo');
    }
  }

  /** Persiste el rollup sin propagar errores (mismo motivo que `sampleCycle`). */
  async flushCycle(): Promise<void> {
    try {
      await this.flushRollup();
    } catch (err) {
      this.app.log.error({ err }, '[traffic] el rollup falló; se omite este ciclo');
    }
  }

  start(): void {
    if (this.loop) return;
    // Dos bucles independientes: el muestreo (driver) y el rollup (DB) no se
    // bloquean entre sí, pero ninguno se solapa consigo mismo (US-229).
    // `sampleCycle`/`flushCycle` ya absorben y registran su error (US-98), así que
    // el bucle solo aporta el guard de re-entrada y el `unref`.
    this.loop = createTickLoop({
      intervalMs: this.intervalMs,
      tick: () => this.sampleCycle(),
      onSkip: () =>
        this.app.log.warn('[traffic] el muestreo anterior sigue en curso; se salta este ciclo'),
    });
    this.rollupLoop = createTickLoop({
      intervalMs: this.rollupMs,
      tick: () => this.flushCycle(),
      onSkip: () =>
        this.app.log.warn('[traffic] el rollup anterior sigue en curso; se salta este ciclo'),
    });
    this.loop.start();
    this.rollupLoop.start();
  }

  stop(): void {
    this.loop?.stop();
    this.loop = null;
    this.rollupLoop?.stop();
    this.rollupLoop = null;
  }
}
