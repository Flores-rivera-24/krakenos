import type {
  AccessSchedule,
  CreateAccessScheduleRequest,
  HardwareDriver,
  UpdateAccessScheduleRequest,
} from '@krakenos/types';
import type { AccessSchedule as DbAccessSchedule } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { activeBlockedMacs } from './schedule-eval.js';

function toSchedule(row: DbAccessSchedule): AccessSchedule {
  let days: number[] = [];
  try {
    days = JSON.parse(row.days) as number[];
  } catch {
    days = [];
  }
  return {
    id: row.id,
    name: row.name,
    mac: row.mac,
    enabled: row.enabled,
    days,
    startMinute: row.startMinute,
    endMinute: row.endMinute,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Horarios de acceso / control parental (US-108). Hace dos cosas: CRUD de horarios
 * y un **barrido periódico** que aplica el bloqueo/desbloqueo por horario vía el
 * driver. El bloqueo efectivo de un dispositivo es `manual (Device.isBlocked) OR
 * horario activo`; el servicio solo toca el driver por su cuenta cuando un horario
 * empieza/termina, y **nunca** desbloquea un dispositivo bloqueado a mano.
 */
export class AccessScheduleService {
  private timer: NodeJS.Timeout | null = null;
  /** MACs que este servicio bloqueó por horario (para no pisar bloqueos manuales). */
  private readonly scheduleBlocked = new Set<string>();

  constructor(
    private readonly app: FastifyInstance,
    private readonly driver: HardwareDriver,
  ) {}

  // ---- CRUD ----

  async list(): Promise<AccessSchedule[]> {
    const rows = await this.app.prisma.accessSchedule.findMany({ orderBy: { createdAt: 'asc' } });
    return rows.map(toSchedule);
  }

  async listForMac(mac: string): Promise<AccessSchedule[]> {
    const rows = await this.app.prisma.accessSchedule.findMany({
      where: { mac },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toSchedule);
  }

  async create(body: CreateAccessScheduleRequest): Promise<AccessSchedule> {
    const row = await this.app.prisma.accessSchedule.create({
      data: {
        name: body.name,
        mac: body.mac,
        enabled: body.enabled ?? true,
        days: JSON.stringify([...new Set(body.days)].sort((a, b) => a - b)),
        startMinute: body.startMinute,
        endMinute: body.endMinute,
      },
    });
    return toSchedule(row);
  }

  async update(id: string, patch: UpdateAccessScheduleRequest): Promise<AccessSchedule | null> {
    const existing = await this.app.prisma.accessSchedule.findUnique({ where: { id } });
    if (!existing) return null;
    const row = await this.app.prisma.accessSchedule.update({
      where: { id },
      data: {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(patch.days !== undefined
          ? { days: JSON.stringify([...new Set(patch.days)].sort((a, b) => a - b)) }
          : {}),
        ...(patch.startMinute !== undefined ? { startMinute: patch.startMinute } : {}),
        ...(patch.endMinute !== undefined ? { endMinute: patch.endMinute } : {}),
      },
    });
    return toSchedule(row);
  }

  async remove(id: string): Promise<boolean> {
    const existing = await this.app.prisma.accessSchedule.findUnique({ where: { id } });
    if (!existing) return false;
    await this.app.prisma.accessSchedule.delete({ where: { id } });
    return true;
  }

  /** ¿Hay algún horario ACTIVO ahora para este MAC? (lo usa el inventario al desbloquear). */
  async isBlockedNow(mac: string, now: Date = new Date()): Promise<boolean> {
    const rows = await this.app.prisma.accessSchedule.findMany({ where: { mac, enabled: true } });
    return activeBlockedMacs(rows.map(toSchedule), now).has(mac);
  }

  // ---- Enforcement ----

  /** Aplica el estado de bloqueo por horario en el instante `now`. */
  async tick(now: Date = new Date()): Promise<void> {
    const rows = await this.app.prisma.accessSchedule.findMany({ where: { enabled: true } });
    const active = activeBlockedMacs(rows.map(toSchedule), now);
    // Considera las MAC activas ahora + las que nosotros dejamos bloqueadas.
    const macs = new Set<string>([...active, ...this.scheduleBlocked]);

    for (const mac of macs) {
      const shouldBlock = active.has(mac);
      const managedByUs = this.scheduleBlocked.has(mac);
      if (shouldBlock === managedByUs) continue; // sin cambio

      const device = await this.app.prisma.device.findUnique({ where: { mac } });
      const manual = device?.isBlocked ?? false;
      try {
        if (shouldBlock) {
          if (!manual) await this.driver.blockDevice(mac);
          this.scheduleBlocked.add(mac);
          this.app.audit({ action: 'access.schedule_block', detail: mac });
        } else {
          // Fin de la ventana: solo desbloquea si NO está bloqueado a mano.
          if (!manual) await this.driver.unblockDevice(mac);
          this.scheduleBlocked.delete(mac);
          this.app.audit({ action: 'access.schedule_unblock', detail: mac });
        }
      } catch (err) {
        this.app.log.error({ err, mac }, '[access] fallo al aplicar el horario; se reintenta');
      }
    }
  }

  /** Barrido sin propagar errores (para el timer). */
  private async tickCycle(): Promise<void> {
    try {
      await this.tick();
    } catch (err) {
      this.app.log.error({ err }, '[access] el barrido de horarios falló; se omite');
    }
  }

  start(intervalMs = 60_000): void {
    if (this.timer) return;
    void this.tickCycle();
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
