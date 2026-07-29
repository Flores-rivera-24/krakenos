import type {
  DeviceEnergyStats,
  EnergyBucket,
  EnergyConfig,
  EnergyRange,
  EnergyStats,
  IotManager,
} from '@krakenos/types';
import type { FastifyInstance } from 'fastify';
import { DAY_MS, DEFAULT_ENERGY_RETENTION_DAYS, retentionDays } from '../../config/retention.js';
import { asNumber } from '../../db/sql-aggregate.js';
import { createTickLoop, type TickLoop } from '../../system/tick-loop.js';

/** Error de validación de la configuración de energía (precio inválido). */
export class EnergyConfigError extends Error {
  readonly code = 'ENERGY_CONFIG_INVALID';
}

/** Ventana temporal de cada rango, en milisegundos. */
const RANGE_MS: Record<EnergyRange, number> = {
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
};

/** Tamaño del bucket de agregación por rango, en milisegundos. */
const BUCKET_MS: Record<EnergyRange, number> = {
  day: 60 * 60 * 1000, // 1 hora → 24 puntos
  week: 24 * 60 * 60 * 1000, // 1 día  → 7 puntos
  month: 24 * 60 * 60 * 1000, // 1 día  → 30 puntos
};

/** Acumulador del rollup en curso para un dispositivo. */
interface DeviceAcc {
  sumPower: number;
  count: number;
}

/**
 * Medición de consumo eléctrico (US-181). Sondea la potencia instantánea
 * (`IotDevice.powerW`) de los dispositivos que la reportan y persiste un
 * **rollup** por minuto (media de potencia) por dispositivo en `EnergySample`.
 * La energía (Wh/kWh) y el coste se **integran** al agregar (`getStats`), igual
 * que el tráfico deriva bytes totales de la tasa media (patrón de `TrafficService`).
 *
 * Solo los backends que miden potencia generan filas (Shelly, el mock la simula);
 * un dispositivo sin `powerW` numérico se omite sin romper nada.
 */
export class EnergyService {
  private loop: TickLoop | null = null;
  private rollupLoop: TickLoop | null = null;

  /** Acumulador del rollup por dispositivo: id → sumas de potencia. */
  private acc = new Map<string, DeviceAcc>();

  constructor(
    private readonly app: FastifyInstance,
    private readonly iot: IotManager,
    private readonly intervalMs = 15_000,
    private readonly rollupMs = 60_000,
  ) {}

  /** Toma una muestra de potencia de cada dispositivo que la reporta y la acumula. */
  async sampleOnce(): Promise<void> {
    const devices = await this.iot.listDevices();
    for (const d of devices) {
      const power = d.powerW;
      if (typeof power !== 'number' || !Number.isFinite(power)) continue;
      const cur = this.acc.get(d.id) ?? { sumPower: 0, count: 0 };
      cur.sumPower += power;
      cur.count += 1;
      this.acc.set(d.id, cur);
    }
  }

  /**
   * Persiste la media de potencia acumulada por dispositivo como un rollup y poda
   * los rollups más antiguos que la retención. No escribe nada si no hubo muestras.
   */
  async flushRollup(): Promise<void> {
    const entries = [...this.acc.entries()];
    this.acc.clear();

    const days = await retentionDays(
      this.app.prisma,
      'energyRetentionDays',
      DEFAULT_ENERGY_RETENTION_DAYS,
    );
    const cutoff = new Date(Date.now() - days * DAY_MS);

    // `createMany` en vez de N `create` (US-228): una transacción por barrido en vez
    // de una por aparato — en microSD, cada transacción son 2 fsync.
    const samples = entries
      .filter(([, a]) => a.count > 0)
      .map(([deviceId, a]) => ({ deviceId, powerW: a.sumPower / a.count }));
    if (samples.length > 0) {
      await this.app.prisma.energySample.createMany({ data: samples });
    }
    await this.app.prisma.energySample.deleteMany({ where: { timestamp: { lt: cutoff } } });
  }

  /** Símbolo de moneda por defecto (el proyecto nació en España). */
  private static readonly DEFAULT_CURRENCY = '€';

  /** Precio del kWh configurado (ajuste del hogar `energyPricePerKwh`), o `null`. */
  private async pricePerKwh(): Promise<number | null> {
    const row = await this.app.prisma.setting.findUnique({ where: { key: 'energyPricePerKwh' } });
    if (!row) return null;
    const n = Number(row.value);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }

  /** Configuración de energía del hogar: precio del kWh + moneda (US-182). */
  async getConfig(): Promise<EnergyConfig> {
    const currencyRow = await this.app.prisma.setting.findUnique({
      where: { key: 'energyCurrency' },
    });
    const currency = currencyRow?.value?.trim() || EnergyService.DEFAULT_CURRENCY;
    return { pricePerKwh: await this.pricePerKwh(), currency };
  }

  /**
   * Guarda la configuración de energía del hogar (US-182). `pricePerKwh` negativo o
   * no finito se rechaza; `null` limpia el precio (vuelve a "sin coste").
   */
  async setConfig(input: { pricePerKwh?: number | null; currency?: string }): Promise<EnergyConfig> {
    if (input.pricePerKwh !== undefined) {
      if (input.pricePerKwh === null) {
        await this.app.prisma.setting.deleteMany({ where: { key: 'energyPricePerKwh' } });
      } else {
        const p = input.pricePerKwh;
        if (!Number.isFinite(p) || p < 0) {
          throw new EnergyConfigError('El precio del kWh debe ser un número ≥ 0');
        }
        await this.app.prisma.setting.upsert({
          where: { key: 'energyPricePerKwh' },
          create: { key: 'energyPricePerKwh', value: String(p) },
          update: { value: String(p) },
        });
      }
    }
    if (input.currency !== undefined) {
      const currency = input.currency.trim() || EnergyService.DEFAULT_CURRENCY;
      await this.app.prisma.setting.upsert({
        where: { key: 'energyCurrency' },
        create: { key: 'energyCurrency', value: currency },
        update: { value: currency },
      });
    }
    return this.getConfig();
  }

  /**
   * Suma de energía (Wh) persistida en la ventana `[since, until)`.
   *
   * Sumado por la base (US-228): traía todas las filas del periodo para reducirlas
   * con un `reduce` — con retención de 90 días y 6 medidores, `range=month` eran
   * ~260.000 filas **solo para la comparativa** del periodo anterior.
   */
  private async energyBetween(since: Date, until: Date): Promise<number> {
    const agg = await this.app.prisma.energySample.aggregate({
      where: { timestamp: { gte: since, lt: until } },
      _sum: { powerW: true },
    });
    const rollupHours = this.rollupMs / 1000 / 3600;
    const wh = (agg._sum.powerW ?? 0) * rollupHours;
    return Math.round(wh * 100) / 100;
  }

  /**
   * Estadísticas de consumo para una ventana: serie del hogar en buckets, total
   * de energía y coste estimado, y el desglose por dispositivo (nombre/estancia
   * desde el manager vivo). La energía se integra de la potencia media persistida.
   */
  async getStats(range: EnergyRange): Promise<EnergyStats> {
    const now = Date.now();
    const windowMs = RANGE_MS[range];
    const since = new Date(now - windowMs);
    const bucketMs = BUCKET_MS[range];

    // Agregado en SQL (US-228/AUD3-13): `range=month` con 10 enchufes medidores
    // cargaba ~864.000 filas, y el snapshot de MQTT llama a `getStats('day')` **cada
    // 30 s**. Ahora salen `dispositivos × buckets` filas.
    const rows = await this.app.prisma.$queryRaw<
      {
        deviceId: string;
        bucket: number | bigint;
        sumPower: number;
        samples: number | bigint;
      }[]
    >`
      SELECT deviceId,
             (timestamp / ${bucketMs}) * ${bucketMs} AS bucket,
             SUM(powerW) AS sumPower,
             COUNT(*) AS samples
      FROM EnergySample
      WHERE timestamp >= ${since.getTime()}
      GROUP BY deviceId, bucket
      ORDER BY deviceId ASC, bucket ASC`;
    const rollupHours = this.rollupMs / 1000 / 3600;
    const { pricePerKwh: price, currency } = await this.getConfig();

    // Comparativa vs el periodo inmediatamente anterior, de igual duración (US-182).
    const previousTotalEnergyWh = await this.energyBetween(
      new Date(now - 2 * windowMs),
      since,
    );

    // Nombre/estancia actuales desde el manager (puede ya no existir la fila).
    const live = await this.iot.listDevices().catch(() => []);
    const meta = new Map(live.map((d) => [d.id, { name: d.name, room: d.room }]));

    // Agregación por dispositivo y del hogar. Cada fila viene ya agrupada por
    // (dispositivo, bucket) con la SUMA de potencias y el número de muestras, de
    // modo que la media por bucket sale igual que cuando se hacía en JS: para un
    // dispositivo `sumPower/samples`, y para el hogar la media **ponderada**
    // `Σ sumPower / Σ samples` (idéntica a promediar todas las muestras del bucket,
    // también si un aparato aportó menos muestras que otro).
    interface BucketAcc {
      sumPower: number;
      samples: number;
      energyWh: number;
    }
    const byDevice = new Map<string, Map<number, BucketAcc>>();
    const home = new Map<number, BucketAcc>();

    for (const row of rows) {
      const bucketStart = asNumber(row.bucket);
      const sumPower = asNumber(row.sumPower);
      const samples = asNumber(row.samples);
      const energyWh = sumPower * rollupHours;

      let dev = byDevice.get(row.deviceId);
      if (!dev) {
        dev = new Map();
        byDevice.set(row.deviceId, dev);
      }
      dev.set(bucketStart, { sumPower, samples, energyWh });

      const hCur = home.get(bucketStart) ?? { sumPower: 0, samples: 0, energyWh: 0 };
      hCur.sumPower += sumPower;
      hCur.samples += samples;
      hCur.energyWh += energyWh;
      home.set(bucketStart, hCur);
    }

    const toBuckets = (m: Map<number, BucketAcc>): EnergyBucket[] =>
      [...m.entries()]
        .sort(([a], [b]) => a - b)
        .map(([start, { sumPower, samples, energyWh }]) => ({
          timestamp: new Date(start).toISOString(),
          powerW: Math.round((sumPower / samples) * 10) / 10,
          energyWh: Math.round(energyWh * 100) / 100,
        }));

    const cost = (energyWh: number): number | null =>
      price === null ? null : Math.round((energyWh / 1000) * price * 100) / 100;

    const devices: DeviceEnergyStats[] = [...byDevice.entries()].map(([deviceId, buckets]) => {
      const totalEnergyWh =
        Math.round([...buckets.values()].reduce((s, b) => s + b.energyWh, 0) * 100) / 100;
      const info = meta.get(deviceId);
      return {
        deviceId,
        name: info?.name ?? null,
        room: info?.room ?? null,
        energyWh: totalEnergyWh,
        cost: cost(totalEnergyWh),
        buckets: toBuckets(buckets),
      };
    });
    devices.sort((a, b) => b.energyWh - a.energyWh);

    const totalEnergyWh = Math.round(devices.reduce((s, d) => s + d.energyWh, 0) * 100) / 100;

    return {
      range,
      buckets: toBuckets(home),
      totalEnergyWh,
      previousTotalEnergyWh,
      pricePerKwh: price,
      currency,
      totalCost: cost(totalEnergyWh),
      previousTotalCost: cost(previousTotalEnergyWh),
      devices,
    };
  }

  /** Muestreo sin propagar errores (fire-and-forget del timer). */
  async sampleCycle(): Promise<void> {
    try {
      await this.sampleOnce();
    } catch (err) {
      this.app.log.error({ err }, '[energy] el muestreo falló; se omite este ciclo');
    }
  }

  /** Rollup sin propagar errores (mismo motivo que `sampleCycle`). */
  async flushCycle(): Promise<void> {
    try {
      await this.flushRollup();
    } catch (err) {
      this.app.log.error({ err }, '[energy] el rollup falló; se omite este ciclo');
    }
  }

  start(): void {
    if (this.loop) return;
    // Como en tráfico: los `*Cycle` ya absorben su error; el bucle aporta el
    // guard de re-entrada (un sondeo IoT lento no debe apilar ciclos) y el unref.
    this.loop = createTickLoop({
      intervalMs: this.intervalMs,
      tick: () => this.sampleCycle(),
      onSkip: () =>
        this.app.log.warn('[energy] el muestreo anterior sigue en curso; se salta este ciclo'),
    });
    this.rollupLoop = createTickLoop({
      intervalMs: this.rollupMs,
      tick: () => this.flushCycle(),
      onSkip: () =>
        this.app.log.warn('[energy] el rollup anterior sigue en curso; se salta este ciclo'),
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
