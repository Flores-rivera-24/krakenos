import type {
  CreateSceneRequest,
  IotManager,
  Scene,
  SceneAction,
  SceneRunResult,
  UpdateSceneRequest,
} from '@krakenos/types';
import { IOT_ROOM, SCENE_ICONS } from '@krakenos/types';
import { asEnum } from '../../util/as-enum.js';
import type { Scene as DbScene } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { IotError } from '../../iot/index.js';
import { withActionTimeout } from '../../iot/action-timeout.js';

function parseActions(raw: string): SceneAction[] {
  try {
    const parsed = JSON.parse(raw) as SceneAction[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function toScene(row: DbScene): Scene {
  return {
    id: row.id,
    name: row.name,
    icon: asEnum(row.icon, SCENE_ICONS, 'scene'),
    actions: parseActions(row.actions),
    order: row.order,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Escenas de un toque (US-166): CRUD + ejecución. Al ejecutar, aplica cada acción
 * vía el `IotManager` de forma **best-effort** — un dispositivo caído no impide
 * aplicar el resto — y reporta los fallos parciales por dispositivo. La captura de
 * estado lee el estado actual de N dispositivos para prellenar el editor.
 */
export class SceneService {
  constructor(
    private readonly app: FastifyInstance,
    private readonly iot: IotManager,
  ) {}

  async list(): Promise<Scene[]> {
    const rows = await this.app.prisma.scene.findMany({
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map(toScene);
  }

  async get(id: string): Promise<Scene | null> {
    const row = await this.app.prisma.scene.findUnique({ where: { id } });
    return row ? toScene(row) : null;
  }

  async create(body: CreateSceneRequest): Promise<Scene> {
    const row = await this.app.prisma.scene.create({
      data: {
        name: body.name,
        icon: body.icon ?? 'scene',
        actions: JSON.stringify(body.actions),
        order: body.order ?? 0,
      },
    });
    return toScene(row);
  }

  async update(id: string, patch: UpdateSceneRequest): Promise<Scene | null> {
    const existing = await this.app.prisma.scene.findUnique({ where: { id } });
    if (!existing) return null;
    const row = await this.app.prisma.scene.update({
      where: { id },
      data: {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.icon !== undefined ? { icon: patch.icon } : {}),
        ...(patch.actions !== undefined ? { actions: JSON.stringify(patch.actions) } : {}),
        ...(patch.order !== undefined ? { order: patch.order } : {}),
      },
    });
    return toScene(row);
  }

  async remove(id: string): Promise<boolean> {
    const existing = await this.app.prisma.scene.findUnique({ where: { id } });
    if (!existing) return false;
    await this.app.prisma.scene.delete({ where: { id } });
    // Limpia los favoritos que apuntaban a esta escena (AUD-18): sin esto quedarían
    // referencias huérfanas que la UI no puede resolver.
    await this.app.prisma.favorite.deleteMany({ where: { kind: 'scene', ref: id } });
    return true;
  }

  /**
   * Ejecuta una escena: aplica cada acción vía el `IotManager`. Best-effort con
   * reporte por acción. Devuelve `null` si la escena no existe. Emite
   * `iot:device-updated` por cada acción aplicada para que la UI se sincronice.
   */
  async run(id: string): Promise<SceneRunResult | null> {
    const scene = await this.get(id);
    if (!scene) return null;

    const result: SceneRunResult = { applied: 0, failed: [] };
    for (const action of scene.actions) {
      try {
        // Con timeout: un dispositivo colgado cuenta como fallo y no frena el resto (US-203).
        const device = await withActionTimeout(() =>
          this.iot.setState(action.deviceId, {
            ...(action.on !== undefined ? { on: action.on } : {}),
            ...(action.brightness !== undefined ? { brightness: action.brightness } : {}),
            ...(action.color !== undefined ? { color: action.color } : {}),
          }),
        );
        this.app.io.to(IOT_ROOM).emit('iot:device-updated', device);
        result.applied += 1;
      } catch (err) {
        const message = err instanceof IotError ? err.message : 'error al aplicar la acción';
        result.failed.push({ deviceId: action.deviceId, error: message });
      }
    }
    return result;
  }

  /**
   * Captura el estado actual de los dispositivos dados como acciones de escena
   * (para prellenar el editor con "cómo está ahora"). Ignora los que no existen o
   * no son controlables (un sensor no aporta una acción).
   *
   * Un único `listDevices()` mapeado por id — con un backend real cada
   * `getDevice` era 1 HTTP al bridge, amplificable desde el rol viewer (US-204).
   */
  async captureState(deviceIds: string[]): Promise<SceneAction[]> {
    const snapshot = await this.iot.listDevices().catch(() => []);
    const byId = new Map(snapshot.map((d) => [d.id, d]));
    const actions: SceneAction[] = [];
    for (const deviceId of deviceIds) {
      const device = byId.get(deviceId);
      if (!device || device.on === null) continue; // inexistente o no controlable
      const action: SceneAction = { deviceId, on: device.on };
      if (device.brightness !== null) action.brightness = device.brightness;
      if (device.color !== null) {
        if (device.color.hex !== null) action.color = { hex: device.color.hex };
        else if (device.color.temperatureK !== null) {
          action.color = { temperatureK: device.color.temperatureK };
        }
      }
      actions.push(action);
    }
    return actions;
  }
}
