import type {
  ApPlacement,
  CoverageHeatmap,
  CreateFloorPlanRequest,
  CreateSurveyScanRequest,
  FloorPlan,
  HardwareDriver,
  MeasureResult,
  PlaceableAccessPoint,
  RecordSurveySampleRequest,
  SurveySample,
  SurveyScan,
  SurveyScanDetail,
  UpdateFloorPlanRequest,
  Wall,
  WifiBand,
} from '@krakenos/types';
// Tipos de fila derivados del schema Prisma: si el modelo cambia, el mapeo deja
// de compilar (detecta derivas de schema) en vez de un `as` ciego.
import type {
  FloorPlan as DbFloorPlan,
  SurveySample as DbSurveySample,
  SurveyScan as DbSurveyScan,
} from '@prisma/client';
import type { FastifyInstance } from 'fastify';
// Núcleo puro del cálculo de cobertura (creado en paralelo):
//  · computePredictedHeatmap: modelo de propagación RF (log-distance + atenuación
//    por paredes) a partir de los APs colocados en el plano.
//  · computeMeasuredHeatmap: interpolación IDW de las muestras de un survey.
import { computePredictedHeatmap } from '../../coverage/propagation.js';
import { computeMeasuredHeatmap } from '../../coverage/interpolation.js';

/**
 * Resultado de registrar una muestra. Distingue los tres desenlaces que la ruta
 * traduce a HTTP: `ok` (200 con `MeasureResult`), `scan-not-found` (404) y
 * `no-source` (400: no llegó `rssiDbm` y el survey no tiene `deviceMac` con el
 * que medir en vivo).
 */
export type RecordSampleOutcome =
  | { status: 'ok'; result: MeasureResult }
  | { status: 'scan-not-found' }
  | { status: 'no-source' };

/**
 * Servicio de cobertura WiFi (US-151): CRUD de planos, mapas de calor predichos
 * (propagación RF) y medidos (survey por interpolación), APs colocables tomados
 * en vivo del driver y medición de la señal de un dispositivo itinerante.
 *
 * Las paredes y los APs colocados se persisten como **JSON string** en columnas
 * TEXT; se serializan al escribir y se parsean al leer.
 */
export class CoverageService {
  constructor(
    private readonly app: FastifyInstance,
    private readonly driver: HardwareDriver,
  ) {}

  // ---- Mapeo fila Prisma → DTO del contrato ----

  private toFloorPlan(row: DbFloorPlan): FloorPlan {
    return {
      id: row.id,
      name: row.name,
      widthM: row.widthM,
      heightM: row.heightM,
      backgroundImage: row.backgroundImage,
      walls: this.parseJson<Wall[]>(row.walls, []),
      accessPoints: this.parseJson<ApPlacement[]>(row.accessPoints, []),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toScan(row: DbSurveyScan): SurveyScan {
    return {
      id: row.id,
      floorPlanId: row.floorPlanId,
      name: row.name,
      band: row.band as WifiBand,
      deviceMac: row.deviceMac,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toSample(row: DbSurveySample): SurveySample {
    return {
      id: row.id,
      scanId: row.scanId,
      x: row.x,
      y: row.y,
      rssiDbm: row.rssiDbm,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /**
   * Parsea un campo JSON persistido. Si está corrupto, avisa por el log (no lo
   * silencia) y devuelve el valor por defecto para no tumbar la lectura.
   */
  private parseJson<T>(raw: string, fallback: T): T {
    try {
      return JSON.parse(raw) as T;
    } catch (err) {
      this.app.log.warn({ err, raw }, '[coverage] JSON corrupto; se usa el valor por defecto');
      return fallback;
    }
  }

  // ---- CRUD de planos ----

  async listFloorPlans(): Promise<FloorPlan[]> {
    const rows = await this.app.prisma.floorPlan.findMany({ orderBy: { createdAt: 'desc' } });
    return rows.map((row) => this.toFloorPlan(row));
  }

  async getFloorPlan(id: string): Promise<FloorPlan | null> {
    const row = await this.app.prisma.floorPlan.findUnique({ where: { id } });
    return row ? this.toFloorPlan(row) : null;
  }

  async createFloorPlan(input: CreateFloorPlanRequest): Promise<FloorPlan> {
    const row = await this.app.prisma.floorPlan.create({
      data: {
        name: input.name,
        widthM: input.widthM,
        heightM: input.heightM,
        backgroundImage: input.backgroundImage ?? null,
        walls: JSON.stringify(input.walls ?? []),
        accessPoints: JSON.stringify(input.accessPoints ?? []),
      },
    });
    return this.toFloorPlan(row);
  }

  async updateFloorPlan(id: string, input: UpdateFloorPlanRequest): Promise<FloorPlan | null> {
    const existing = await this.app.prisma.floorPlan.findUnique({ where: { id } });
    if (!existing) return null;

    const row = await this.app.prisma.floorPlan.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.widthM !== undefined ? { widthM: input.widthM } : {}),
        ...(input.heightM !== undefined ? { heightM: input.heightM } : {}),
        ...(input.backgroundImage !== undefined ? { backgroundImage: input.backgroundImage } : {}),
        ...(input.walls !== undefined ? { walls: JSON.stringify(input.walls) } : {}),
        ...(input.accessPoints !== undefined
          ? { accessPoints: JSON.stringify(input.accessPoints) }
          : {}),
      },
    });
    return this.toFloorPlan(row);
  }

  /** Borra un plano (y en cascada sus surveys/muestras). `false` si no existía. */
  async deleteFloorPlan(id: string): Promise<boolean> {
    const existing = await this.app.prisma.floorPlan.findUnique({ where: { id } });
    if (!existing) return false;
    await this.app.prisma.floorPlan.delete({ where: { id } });
    return true;
  }

  // ---- Mapas de calor ----

  /** Mapa de calor **predicho** por propagación RF para una banda. `null` si el plano no existe. */
  async predictedHeatmap(id: string, band: WifiBand): Promise<CoverageHeatmap | null> {
    const row = await this.app.prisma.floorPlan.findUnique({ where: { id } });
    if (!row) return null;
    const plan = this.toFloorPlan(row);
    return computePredictedHeatmap(plan.widthM, plan.heightM, plan.accessPoints, plan.walls, {
      band,
    });
  }

  /** Mapa de calor **medido** (interpolación de las muestras del survey). `null` si el survey no existe. */
  async measuredHeatmap(scanId: string): Promise<CoverageHeatmap | null> {
    const scan = await this.app.prisma.surveyScan.findUnique({
      where: { id: scanId },
      include: { samples: true },
    });
    if (!scan) return null;
    const floorPlan = await this.app.prisma.floorPlan.findUnique({
      where: { id: scan.floorPlanId },
    });
    if (!floorPlan) return null;
    const samples = scan.samples.map((s) => this.toSample(s));
    const plan = this.toFloorPlan(floorPlan);
    return computeMeasuredHeatmap(plan.widthM, plan.heightM, samples, {
      band: scan.band as WifiBand,
    });
  }

  // ---- APs colocables (en vivo desde el driver) ----

  /**
   * APs disponibles para colocar en el plano, tomados en vivo del driver. Agrega
   * las bandas de las redes de cada AP (únicas), agrupadas por `apId`.
   */
  async listPlaceableAccessPoints(): Promise<PlaceableAccessPoint[]> {
    const [aps, networks] = await Promise.all([
      this.driver.listAccessPoints(),
      this.driver.listWifiNetworks(),
    ]);

    const bandsByAp = new Map<string, WifiBand[]>();
    for (const net of networks) {
      const bands = bandsByAp.get(net.apId) ?? [];
      if (!bands.includes(net.band)) bands.push(net.band);
      bandsByAp.set(net.apId, bands);
    }

    return aps.map((ap) => ({
      id: ap.id,
      name: ap.name,
      model: ap.model,
      ip: ap.ip,
      online: ap.online,
      bands: bandsByAp.get(ap.id) ?? [],
    }));
  }

  // ---- Surveys y muestras ----

  /** Surveys de un plano. `null` si el plano no existe. */
  async listScans(floorPlanId: string): Promise<SurveyScan[] | null> {
    const plan = await this.app.prisma.floorPlan.findUnique({ where: { id: floorPlanId } });
    if (!plan) return null;
    const rows = await this.app.prisma.surveyScan.findMany({
      where: { floorPlanId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => this.toScan(row));
  }

  /** Crea un survey en un plano. `null` si el plano no existe. */
  async createScan(
    floorPlanId: string,
    input: CreateSurveyScanRequest,
  ): Promise<SurveyScan | null> {
    const plan = await this.app.prisma.floorPlan.findUnique({ where: { id: floorPlanId } });
    if (!plan) return null;
    const row = await this.app.prisma.surveyScan.create({
      data: {
        floorPlanId,
        name: input.name,
        band: input.band,
        deviceMac: input.deviceMac ?? null,
      },
    });
    return this.toScan(row);
  }

  /** Survey con sus muestras cargadas. `null` si no existe. */
  async getScanDetail(scanId: string): Promise<SurveyScanDetail | null> {
    const row = await this.app.prisma.surveyScan.findUnique({
      where: { id: scanId },
      include: { samples: { orderBy: { createdAt: 'asc' } } },
    });
    if (!row) return null;
    return {
      ...this.toScan(row),
      samples: row.samples.map((s) => this.toSample(s)),
    };
  }

  /** Borra un survey (y en cascada sus muestras). `false` si no existía. */
  async deleteScan(scanId: string): Promise<boolean> {
    const existing = await this.app.prisma.surveyScan.findUnique({ where: { id: scanId } });
    if (!existing) return false;
    await this.app.prisma.surveyScan.delete({ where: { id: scanId } });
    return true;
  }

  /**
   * Registra una muestra en un survey. Si `rssiDbm` viene en la petición, se
   * guarda esa medida directamente (`found: true`). Si no viene, se mide en vivo
   * la señal del `deviceMac` del survey a través del driver:
   *  · sin `deviceMac` → `no-source` (la ruta responde 400).
   *  · con `deviceMac` pero el dispositivo no está conectado → `found: false`
   *    (200, sin crear muestra).
   */
  async recordSample(
    scanId: string,
    input: RecordSurveySampleRequest,
  ): Promise<RecordSampleOutcome> {
    const scan = await this.app.prisma.surveyScan.findUnique({ where: { id: scanId } });
    if (!scan) return { status: 'scan-not-found' };

    let rssiDbm: number;
    if (input.rssiDbm !== undefined) {
      rssiDbm = input.rssiDbm;
    } else {
      if (!scan.deviceMac) return { status: 'no-source' };
      // Mide en la banda del survey: un móvil dual-band no debe contaminar el
      // heatmap de 5 GHz con su lectura de 2.4 GHz (y viceversa).
      const measured = await this.getDeviceSignal(scan.deviceMac, scan.band as WifiBand);
      if (measured === null) {
        return { status: 'ok', result: { found: false, rssiDbm: null, sample: null } };
      }
      rssiDbm = measured;
    }

    const row = await this.app.prisma.surveySample.create({
      data: { scanId, x: input.x, y: input.y, rssiDbm: Math.round(rssiDbm) },
    });
    const sample = this.toSample(row);
    return { status: 'ok', result: { found: true, rssiDbm: sample.rssiDbm, sample } };
  }

  /**
   * Mide en vivo la señal de un dispositivo por su MAC recorriendo las redes del
   * driver y sus clientes (comparación case-insensitive). Si se indica `band`,
   * solo considera las redes de esa banda (para no mezclar bandas en un survey).
   * Devuelve el `signalDbm` **más fuerte** (máximo) entre los APs donde aparezca,
   * o `null` si no está conectado a ninguno.
   */
  async getDeviceSignal(mac: string, band?: WifiBand): Promise<number | null> {
    const target = mac.toLowerCase();
    const networks = await this.driver.listWifiNetworks();
    let strongest: number | null = null;
    for (const net of networks) {
      if (band && net.band !== band) continue;
      const clients = await this.driver.listNetworkClients(net.id);
      if (!clients) continue;
      for (const client of clients) {
        if (client.mac.toLowerCase() === target) {
          if (strongest === null || client.signalDbm > strongest) {
            strongest = client.signalDbm;
          }
        }
      }
    }
    return strongest;
  }
}
