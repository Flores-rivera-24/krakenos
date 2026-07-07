import type {
  AssignRoomRequest,
  CreateRoomRequest,
  IotManager,
  Room,
  RoomActionResult,
  RoomGroupActionRequest,
  RoomIcon,
  RoomWithState,
  UpdateRoomRequest,
} from '@krakenos/types';
import { IOT_ROOM } from '@krakenos/types';
import type { Room as DbRoom } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { IotError } from '../../iot/index.js';
import type { InventoryService } from '../inventory/inventory.service.js';

function toRoom(row: DbRoom): Room {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon as RoomIcon,
    order: row.order,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Habitaciones y grupos de dispositivos (US-165). CRUD de habitaciones, asignación
 * de dispositivos (de red vía `Device.roomId`, IoT vía la tabla `IotRoomMember`) y
 * acciones de grupo sobre los IoT controlables de una habitación (best-effort, con
 * reporte de fallos parciales). La asignación de dispositivos de red se delega en
 * `InventoryService.setRoom` para reusar su mapeo y emisión en tiempo real.
 */
export class RoomService {
  constructor(
    private readonly app: FastifyInstance,
    private readonly iot: IotManager,
    private readonly inventory: InventoryService,
  ) {}

  // ---- CRUD ----

  /**
   * Lista las habitaciones con el estado **agregado** de sus dispositivos (para
   * los tiles). Cruza los miembros IoT con el snapshot vivo del `IotManager`; si
   * el manager IoT está caído, degrada a contadores IoT en cero (no rompe la vista).
   */
  async list(): Promise<RoomWithState[]> {
    const rooms = await this.app.prisma.room.findMany({
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });

    // Conteo de dispositivos de red por habitación (una sola agregación).
    const deviceGroups = await this.app.prisma.device.groupBy({
      by: ['roomId'],
      where: { roomId: { not: null } },
      _count: { _all: true },
    });
    const deviceCounts = new Map<string, number>();
    for (const g of deviceGroups) {
      if (g.roomId) deviceCounts.set(g.roomId, g._count._all);
    }

    // Miembros IoT por habitación + snapshot vivo para el estado on/reachable.
    const members = await this.app.prisma.iotRoomMember.findMany();
    const membersByRoom = new Map<string, string[]>();
    for (const m of members) {
      const list = membersByRoom.get(m.roomId) ?? [];
      list.push(m.iotDeviceId);
      membersByRoom.set(m.roomId, list);
    }
    const iotById = new Map<string, { on: boolean | null; reachable: boolean }>();
    try {
      for (const d of await this.iot.listDevices()) {
        iotById.set(d.id, { on: d.on, reachable: d.reachable });
      }
    } catch (err) {
      this.app.log.error({ err }, '[rooms] no se pudo leer el snapshot IoT para agregar estado');
    }

    return rooms.map((room) => {
      const iotIds = membersByRoom.get(room.id) ?? [];
      let controllableCount = 0;
      let onCount = 0;
      let anyUnreachable = false;
      for (const id of iotIds) {
        const state = iotById.get(id);
        if (!state) continue; // miembro sin correspondencia viva (offline/eliminado)
        if (!state.reachable) anyUnreachable = true;
        if (state.on !== null) {
          controllableCount += 1;
          if (state.on) onCount += 1;
        }
      }
      return {
        ...toRoom(room),
        deviceCount: deviceCounts.get(room.id) ?? 0,
        iotCount: iotIds.length,
        controllableCount,
        onCount,
        anyUnreachable,
        iotDeviceIds: iotIds,
      };
    });
  }

  async get(id: string): Promise<Room | null> {
    const row = await this.app.prisma.room.findUnique({ where: { id } });
    return row ? toRoom(row) : null;
  }

  async create(body: CreateRoomRequest): Promise<Room> {
    const row = await this.app.prisma.room.create({
      data: {
        name: body.name,
        icon: body.icon ?? 'generic',
        order: body.order ?? 0,
      },
    });
    return toRoom(row);
  }

  async update(id: string, patch: UpdateRoomRequest): Promise<Room | null> {
    const existing = await this.app.prisma.room.findUnique({ where: { id } });
    if (!existing) return null;
    const row = await this.app.prisma.room.update({
      where: { id },
      data: {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.icon !== undefined ? { icon: patch.icon } : {}),
        ...(patch.order !== undefined ? { order: patch.order } : {}),
      },
    });
    return toRoom(row);
  }

  async remove(id: string): Promise<boolean> {
    const existing = await this.app.prisma.room.findUnique({ where: { id } });
    if (!existing) return false;
    // `Device.roomId` se pone a null (onDelete: SetNull) y los `IotRoomMember` se
    // borran (onDelete: Cascade) automáticamente por las FK de la migración.
    await this.app.prisma.room.delete({ where: { id } });
    return true;
  }

  // ---- Asignación ----

  /**
   * Asigna un dispositivo (de red o IoT) a una habitación, o lo desasigna con
   * `roomId: null`. Devuelve `false` si el dispositivo de red no existe o la
   * habitación destino no existe (→ 404 en la ruta).
   */
  async assign(req: AssignRoomRequest): Promise<boolean> {
    if (req.roomId !== null) {
      const room = await this.app.prisma.room.findUnique({ where: { id: req.roomId } });
      if (!room) return false;
    }

    if (req.kind === 'device') {
      const device = await this.inventory.setRoom(req.ref, req.roomId);
      return device !== null;
    }

    // IoT: mapeo en `IotRoomMember`. Desasignar = borrar la fila; asignar = upsert.
    if (req.roomId === null) {
      await this.app.prisma.iotRoomMember.deleteMany({ where: { iotDeviceId: req.ref } });
    } else {
      await this.app.prisma.iotRoomMember.upsert({
        where: { iotDeviceId: req.ref },
        create: { iotDeviceId: req.ref, roomId: req.roomId },
        update: { roomId: req.roomId },
      });
    }
    return true;
  }

  // ---- Acción de grupo ----

  /**
   * Aplica una acción (encender/apagar/atenuar) a **todos los IoT controlables**
   * de una habitación. Best-effort: continúa ante el fallo de un dispositivo y
   * reporta los fallos parciales. Devuelve `null` si la habitación no existe.
   */
  async runGroupAction(
    roomId: string,
    action: RoomGroupActionRequest,
  ): Promise<RoomActionResult | null> {
    const room = await this.app.prisma.room.findUnique({ where: { id: roomId } });
    if (!room) return null;

    const members = await this.app.prisma.iotRoomMember.findMany({ where: { roomId } });
    const result: RoomActionResult = { applied: 0, failed: [] };

    for (const member of members) {
      try {
        const device = await this.iot.setState(member.iotDeviceId, action);
        this.app.io.to(IOT_ROOM).emit('iot:device-updated', device);
        result.applied += 1;
      } catch (err) {
        // Un sensor (no controlable) o un dispositivo caído no debe abortar el resto.
        const message = err instanceof IotError ? err.message : 'error al aplicar la acción';
        result.failed.push({ deviceId: member.iotDeviceId, error: message });
      }
    }
    return result;
  }
}
