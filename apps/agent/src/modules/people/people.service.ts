import type {
  PeopleResponse,
  PersonActionResult,
  PersonSummary,
  SetBedtimeRequest,
} from '@krakenos/types';
import type { FastifyInstance } from 'fastify';
import { settleWithLimit } from '../../iot/batch.js';
import { toSchedule, type AccessScheduleService } from '../access/access.service.js';
import { planPersonScheduleReconcile, type PersonScheduleRow } from './bedtime-plan.js';
import { groupByPerson, type DeviceRow, type PersonRow } from './people-group.js';

/**
 * Personas del hogar (US-240): el control parental **por quien es, no por MAC**.
 *
 * No introduce un mecanismo nuevo de corte —sigue habiendo pausa, horario y
 * bloqueo, evaluados por `access/blocked-eval.ts`— sino la **unidad correcta**:
 * la persona. El fan-out a sus dispositivos lo hace el servidor, que es quien
 * sabe cuáles son.
 *
 * **Privacidad por rol** (misma regla que el bienestar, US-184): un admin ve el
 * hogar entero; cualquier otro rol ve **solo sus propios** dispositivos. La
 * autoridad es del servidor, no de la UI — y aquí importa más que en otras
 * pantallas, porque `Device.ownerId` + `online` es presencia, que US-169 declara
 * privada.
 */

/** Nombre de las filas que genera la «hora de dormir» de una persona. */
export const BEDTIME_NAME = 'Hora de dormir';

/** Etiqueta del grupo de dispositivos sin dueño. */
const UNASSIGNED_LABEL = 'Sin asignar';

/** Vista mínima del solicitante para aplicar la privacidad por rol. */
export interface Viewer {
  sub: string;
  role: string;
}

export class PeopleService {
  constructor(
    private readonly app: FastifyInstance,
    private readonly access: AccessScheduleService,
  ) {}

  // ---- Lectura ----

  async list(viewer: Viewer, now: Date = new Date()): Promise<PeopleResponse> {
    const isAdmin = viewer.role === 'admin';

    const [devices, users, schedules] = await Promise.all([
      this.app.prisma.device.findMany({
        where: isAdmin ? {} : { ownerId: viewer.sub },
        select: {
          id: true,
          mac: true,
          label: true,
          hostname: true,
          online: true,
          isBlocked: true,
          pausedUntil: true,
          ownerId: true,
        },
      }),
      this.app.prisma.user.findMany({
        where: isAdmin ? { status: 'active' } : { id: viewer.sub },
        select: { id: true, displayName: true, role: true },
        orderBy: { displayName: 'asc' },
      }),
      this.app.prisma.accessSchedule.findMany({
        where: isAdmin ? {} : { personId: viewer.sub },
      }),
    ]);

    const people = groupByPerson({
      devices: devices as DeviceRow[],
      people: users as PersonRow[],
      schedules: schedules.map(toSchedule),
      now,
      unassignedLabel: UNASSIGNED_LABEL,
    });

    // Los aparatos sin dueño solo se cuentan para quien puede hacer algo con ellos:
    // a un no-admin la consulta ya le devolvió únicamente los suyos.
    const unassignedDevices = isAdmin ? devices.filter((d) => d.ownerId === null).length : 0;

    return { people, fullHome: isAdmin, unassignedDevices };
  }

  /** Una persona concreta, o `null` si no existe (o el solicitante no puede verla). */
  async get(userId: string, viewer: Viewer, now: Date = new Date()): Promise<PersonSummary | null> {
    if (viewer.role !== 'admin' && viewer.sub !== userId) return null;
    const { people } = await this.list(viewer, now);
    return people.find((p) => p.userId === userId) ?? null;
  }

  // ---- Acciones sobre todos los dispositivos de una persona ----

  /** MACs de los dispositivos de una persona. */
  private async macsOf(userId: string): Promise<string[]> {
    const rows = await this.app.prisma.device.findMany({
      where: { ownerId: userId },
      select: { mac: true },
      orderBy: { mac: 'asc' },
    });
    return rows.map((r) => r.mac);
  }

  /**
   * Pausa el internet de **todos** los dispositivos de una persona. Best-effort y
   * lo declara: el driver puede aceptar unos y no otros, y el barrido reintenta
   * los que fallaron dentro del minuto siguiente.
   */
  async pause(userId: string, minutes: number): Promise<PersonActionResult> {
    const macs = await this.macsOf(userId);
    const results = await settleWithLimit(macs, (mac) => this.access.pause(mac, minutes));

    let applied = 0;
    let failed = 0;
    let pausedUntil: Date | null = null;
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value.applied) {
        applied += 1;
        if (!pausedUntil || r.value.pausedUntil > pausedUntil) pausedUntil = r.value.pausedUntil;
      } else {
        failed += 1;
      }
    }
    return {
      applied,
      failed,
      ...(pausedUntil ? { pausedUntil: pausedUntil.toISOString() } : {}),
    };
  }

  /** Reanuda el internet de todos los dispositivos de una persona. */
  async resume(userId: string): Promise<PersonActionResult> {
    const macs = await this.macsOf(userId);
    const results = await settleWithLimit(macs, (mac) => this.access.resume(mac));
    const applied = results.filter((r) => r.status === 'fulfilled' && r.value.applied).length;
    return { applied, failed: results.length - applied };
  }

  // ---- «Hora de dormir» ----

  /**
   * Define (o redefine) la hora de dormir de una persona: una fila por cada uno de
   * sus dispositivos, atadas con `personId`. Reemplaza por completo lo anterior —
   * es **una** ventana por persona, no una lista; los horarios finos siguen
   * estando en el detalle de cada dispositivo.
   */
  async setBedtime(userId: string, input: SetBedtimeRequest): Promise<PersonActionResult> {
    const macs = await this.macsOf(userId);
    const days = JSON.stringify([...new Set(input.days)].sort((a, b) => a - b));

    await this.app.prisma.$transaction([
      this.app.prisma.accessSchedule.deleteMany({ where: { personId: userId } }),
      this.app.prisma.accessSchedule.createMany({
        data: macs.map((mac) => ({
          name: BEDTIME_NAME,
          mac,
          personId: userId,
          enabled: input.enabled ?? true,
          days,
          startMinute: input.startMinute,
          endMinute: input.endMinute,
        })),
      }),
    ]);

    // Aplicar ya: sin esto, una ventana que empieza *ahora* esperaría al barrido y
    // el usuario vería «guardado» con el aparato todavía navegando.
    await this.access.tick();
    return { applied: macs.length, failed: 0 };
  }

  /** Quita la hora de dormir de una persona (y su corte, si estaba activo). */
  async clearBedtime(userId: string): Promise<PersonActionResult> {
    const { count } = await this.app.prisma.accessSchedule.deleteMany({
      where: { personId: userId },
    });
    await this.access.tick();
    return { applied: count, failed: 0 };
  }

  // ---- Reconciliación (la llama el barrido de acceso) ----

  /**
   * Ajusta los horarios de persona al inventario vigente. Lo invoca el barrido de
   * `AccessScheduleService` en cada ciclo: sin esto, un aparato que cambia de
   * dueño arrastraría el corte de su dueño anterior, y uno nuevo se quedaría fuera
   * de la hora de dormir de su persona sin que nada lo indicara.
   */
  async reconcile(): Promise<void> {
    const [rows, devices] = await Promise.all([
      this.app.prisma.accessSchedule.findMany({ where: { personId: { not: null } } }),
      this.app.prisma.device.findMany({ select: { mac: true, ownerId: true } }),
    ]);
    if (rows.length === 0) return;

    const plan = planPersonScheduleReconcile({
      rows: rows as PersonScheduleRow[],
      ownerByMac: new Map(devices.map((d) => [d.mac, d.ownerId])),
    });
    if (plan.deleteIds.length === 0 && plan.create.length === 0) return;

    if (plan.deleteIds.length > 0) {
      await this.app.prisma.accessSchedule.deleteMany({ where: { id: { in: plan.deleteIds } } });
    }
    if (plan.create.length > 0) {
      await this.app.prisma.accessSchedule.createMany({ data: plan.create });
    }
    this.app.log.info(
      { removed: plan.deleteIds.length, added: plan.create.length },
      '[people] horarios de persona reconciliados con el inventario',
    );
  }
}
