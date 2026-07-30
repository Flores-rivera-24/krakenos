import type {
  HardwareDriver,
  PersonUsage,
  UsageBucket,
  WellbeingRange,
  WellbeingUsage,
} from '@krakenos/types';
import type { FastifyInstance } from 'fastify';
import { asNumber } from '../../db/sql-aggregate.js';
import { resolvePerDeviceTraffic } from '../../drivers/capabilities.js';

/** Ventana temporal de cada rango, en milisegundos. */
const RANGE_MS: Record<WellbeingRange, number> = {
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
};

/** Tamaño del bucket por rango, en milisegundos. */
const BUCKET_MS: Record<WellbeingRange, number> = {
  day: 60 * 60 * 1000, // 1 hora → 24 puntos
  week: 24 * 60 * 60 * 1000, // 1 día  → 7 puntos
};

/** Clave para el grupo de dispositivos sin dueño asignado. */
const UNASSIGNED = 'unassigned';

/** Vista mínima del solicitante para aplicar la privacidad por rol. */
export interface Viewer {
  sub: string;
  role: string;
}

/**
 * Bienestar digital (US-184): informe de uso de internet por persona. Agrega el
 * tráfico por dispositivo (US-46, `DeviceTrafficSample`) sobre el dueño del
 * aparato (`Device.ownerId`, US-179). **Privacidad por rol**: un admin ve todo el
 * hogar (incluidos los aparatos sin dueño); cualquier otro rol ve **solo lo
 * suyo** — la autoridad es del servidor, no de la UI.
 */
export class WellbeingService {
  constructor(
    private readonly app: FastifyInstance,
    private readonly driver: HardwareDriver,
    private readonly rollupMs = 60_000,
  ) {}

  async usageByPerson(range: WellbeingRange, viewer: Viewer): Promise<WellbeingUsage> {
    const isAdmin = viewer.role === 'admin';
    const since = new Date(Date.now() - RANGE_MS[range]);

    // mac → ownerId (los aparatos sin fila de inventario o sin dueño → sin asignar).
    const devices = await this.app.prisma.device.findMany({ select: { mac: true, ownerId: true } });
    const ownerByMac = new Map(devices.map((d) => [d.mac.toLowerCase(), d.ownerId]));
    const devicesWithOwner = devices.filter((d) => d.ownerId !== null).length;

    const rollupSeconds = this.rollupMs / 1000;
    const bucketMs = BUCKET_MS[range];

    // Agregado en SQL (US-228/AUD3-13): con 40 aparatos, `range=week` traía ~403.000
    // filas (~100 MB de heap) para pintar 7 puntos por persona — y esta lectura la
    // puede pedir **cualquier rol**. Ahora salen `macs × buckets` filas.
    const rows = await this.app.prisma.$queryRaw<
      { mac: string; bucket: number | bigint; sumRx: number; sumTx: number }[]
    >`
      SELECT mac,
             (timestamp / ${bucketMs}) * ${bucketMs} AS bucket,
             SUM(rxBytesPerSec) AS sumRx,
             SUM(txBytesPerSec) AS sumTx
      FROM DeviceTrafficSample
      WHERE timestamp >= ${since.getTime()}
      GROUP BY mac, bucket
      ORDER BY mac ASC, bucket ASC`;

    interface Acc {
      rx: number;
      tx: number;
      macs: Set<string>;
      buckets: Map<number, number>;
    }
    const byOwner = new Map<string, Acc>();

    for (const row of rows) {
      const owner = ownerByMac.get(row.mac.toLowerCase()) ?? null;
      const key = owner ?? UNASSIGNED;
      // Privacidad: un no-admin solo agrega sus propios aparatos.
      if (!isAdmin && owner !== viewer.sub) continue;

      const acc = byOwner.get(key) ?? { rx: 0, tx: 0, macs: new Set(), buckets: new Map() };
      const rxBytes = asNumber(row.sumRx) * rollupSeconds;
      const txBytes = asNumber(row.sumTx) * rollupSeconds;
      acc.rx += rxBytes;
      acc.tx += txBytes;
      acc.macs.add(row.mac.toLowerCase());
      const bucketStart = asNumber(row.bucket);
      acc.buckets.set(bucketStart, (acc.buckets.get(bucketStart) ?? 0) + rxBytes + txBytes);
      byOwner.set(key, acc);
    }

    // Nombres de las personas dueñas (nunca emails; solo displayName, US-85).
    const userIds = [...byOwner.keys()].filter((k) => k !== UNASSIGNED);
    const users = await this.app.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, displayName: true },
    });
    const nameById = new Map(users.map((u) => [u.id, u.displayName]));

    const people: PersonUsage[] = [...byOwner.entries()].map(([key, acc]) => {
      const buckets: UsageBucket[] = [...acc.buckets.entries()]
        .sort(([a], [b]) => a - b)
        .map(([start, bytes]) => ({ timestamp: new Date(start).toISOString(), bytes: Math.round(bytes) }));
      return {
        userId: key === UNASSIGNED ? null : key,
        name: key === UNASSIGNED ? 'Sin asignar' : (nameById.get(key) ?? 'Desconocido'),
        rxBytes: Math.round(acc.rx),
        txBytes: Math.round(acc.tx),
        totalBytes: Math.round(acc.rx + acc.tx),
        deviceCount: acc.macs.size,
        buckets,
      };
    });

    people.sort((a, b) => b.totalBytes - a.totalBytes);
    // US-263: la capacidad viaja con el informe. Sin desglose por dispositivo esto
    // está vacío SIEMPRE, y culpar de ello a los dueños sin asignar era mandar al
    // usuario a arreglar lo que no estaba roto.
    return {
      range,
      people,
      perDeviceTraffic: await resolvePerDeviceTraffic(this.driver),
      devicesWithOwner,
    };
  }
}
