import type {
  CreateIotScheduleRequest,
  IotManager,
  IotSchedule,
  IotScheduleTarget,
  IotScheduleTime,
  UpdateIotScheduleRequest,
} from '@krakenos/types';
import { IOT_ROOM } from '@krakenos/types';
import type { IotSchedule as DbIotSchedule } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import type { SceneService } from '../scenes/scenes.service.js';
import { type HomeLocation, dueSchedules } from './schedule-eval.js';

function toSchedule(row: DbIotSchedule): IotSchedule {
  let days: number[] = [];
  try {
    days = JSON.parse(row.days) as number[];
  } catch {
    days = [];
  }
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled,
    days,
    time: JSON.parse(row.time) as IotScheduleTime,
    target: JSON.parse(row.target) as IotScheduleTarget,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Horarios para IoT/escenas (US-168): CRUD + un **barrido por minuto** que dispara
 * la acción programada (hora fija o solar amanecer/atardecer). A diferencia de los
 * horarios de acceso (ventanas de bloqueo), esto es un **disparo puntual** en el
 * borde de la hora programada; el `prevTick` evita re-disparar y evita disparos
 * "atrasados" al arrancar.
 */
export class IotScheduleService {
  private timer: NodeJS.Timeout | null = null;
  /** Instante del barrido anterior; el disparo es por cruce (prev, now]. */
  private prevTick: Date | null = null;

  constructor(
    private readonly app: FastifyInstance,
    private readonly iot: IotManager,
    private readonly scenes: SceneService,
  ) {}

  // ---- CRUD ----

  async list(): Promise<IotSchedule[]> {
    const rows = await this.app.prisma.iotSchedule.findMany({ orderBy: { createdAt: 'asc' } });
    return rows.map(toSchedule);
  }

  async create(body: CreateIotScheduleRequest): Promise<IotSchedule> {
    const row = await this.app.prisma.iotSchedule.create({
      data: {
        name: body.name,
        enabled: body.enabled ?? true,
        days: JSON.stringify([...new Set(body.days)].sort((a, b) => a - b)),
        time: JSON.stringify(body.time),
        target: JSON.stringify(body.target),
      },
    });
    return toSchedule(row);
  }

  async update(id: string, patch: UpdateIotScheduleRequest): Promise<IotSchedule | null> {
    const existing = await this.app.prisma.iotSchedule.findUnique({ where: { id } });
    if (!existing) return null;
    const row = await this.app.prisma.iotSchedule.update({
      where: { id },
      data: {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(patch.days !== undefined
          ? { days: JSON.stringify([...new Set(patch.days)].sort((a, b) => a - b)) }
          : {}),
        ...(patch.time !== undefined ? { time: JSON.stringify(patch.time) } : {}),
        ...(patch.target !== undefined ? { target: JSON.stringify(patch.target) } : {}),
      },
    });
    return toSchedule(row);
  }

  async remove(id: string): Promise<boolean> {
    const existing = await this.app.prisma.iotSchedule.findUnique({ where: { id } });
    if (!existing) return false;
    await this.app.prisma.iotSchedule.delete({ where: { id } });
    return true;
  }

  // ---- Enforcement ----

  /** Ubicación del hogar desde `Setting`, o `null` si no está configurada/es inválida. */
  private async homeLocation(): Promise<HomeLocation | null> {
    const rows = await this.app.prisma.setting.findMany({
      where: { key: { in: ['homeLatitude', 'homeLongitude'] } },
    });
    const map = new Map(rows.map((r) => [r.key, r.value]));
    const lat = Number(map.get('homeLatitude'));
    const lon = Number(map.get('homeLongitude'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
    return { lat, lon };
  }

  /** Ejecuta la acción de un horario (dispositivo IoT o escena). */
  private async fire(schedule: IotSchedule): Promise<void> {
    const { target } = schedule;
    try {
      if (target.type === 'device') {
        const device = await this.iot.setState(target.deviceId, {
          ...(target.on !== undefined ? { on: target.on } : {}),
          ...(target.brightness !== undefined ? { brightness: target.brightness } : {}),
        });
        this.app.io.to(IOT_ROOM).emit('iot:device-updated', device);
      } else {
        await this.scenes.run(target.sceneId);
      }
      this.app.audit({ action: 'iot_schedule.fire', detail: `${schedule.id} · ${schedule.name}` });
    } catch (err) {
      this.app.log.error({ err, schedule: schedule.id }, '[iot-schedule] fallo al disparar; se omite');
    }
  }

  /** Aplica los horarios que cruzan su hora entre el barrido anterior y `now`. */
  async tick(now: Date = new Date()): Promise<void> {
    const prev = this.prevTick;
    this.prevTick = now;
    if (!prev) return; // primer barrido: fija la base, no dispara nada atrasado

    const schedules = await this.list();
    const home = await this.homeLocation();
    for (const schedule of dueSchedules(schedules, prev, now, home)) {
      await this.fire(schedule);
    }
  }

  private async tickCycle(): Promise<void> {
    try {
      await this.tick();
    } catch (err) {
      this.app.log.error({ err }, '[iot-schedule] el barrido falló; se omite este ciclo');
    }
  }

  start(intervalMs = 60_000): void {
    if (this.timer) return;
    void this.tickCycle(); // fija prevTick
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
