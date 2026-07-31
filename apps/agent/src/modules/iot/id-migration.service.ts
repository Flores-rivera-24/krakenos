import type { IotKind, IotManager } from '@krakenos/types';
import type { FastifyInstance } from 'fastify';
import {
  planIdMigration,
  remapIdsInJson,
  type MigrationPlan,
} from '../../iot/id-migration.js';

/**
 * Reescritura **una sola vez** de los ids IoT persistidos (US-243).
 *
 * Desde US-243 el `CompositeIotManager` prefija siempre (`hue:foco-1`), también
 * con un único backend. Eso arregla el futuro —añadir el segundo backend ya no
 * cambia ningún id— pero deja a las instalaciones existentes apuntando a ids
 * crudos: escenas, habitaciones, horarios, favoritos, energía y los sensores de la
 * alarma dejarían de casar. Esto los reescribe.
 *
 * Se ejecuta **al arrancar** y se marca hecho en `Setting`, porque:
 * - no puede vivir en una migración SQL de Prisma: el prefijo depende del backend
 *   configurado, que está en `.env`/`IntegrationConfig`, no en el schema;
 * - y necesita **consultar los aparatos vivos** para resolver las instalaciones ya
 *   rotas (las que añadieron un segundo backend antes del arreglo).
 *
 * Lo que no se puede resolver **no se toca y se dice**: apuntar la escena de
 * alguien a un aparato que no es sería peor que dejarla rota y visible.
 */

/** Marca de idempotencia. Versionada por si hiciera falta una segunda pasada. */
const DONE_KEY = 'iot.idsPrefixed.v1';

/** Claves JSON que contienen un id de dispositivo IoT. */
const ID_KEYS = ['deviceId', 'sensorDeviceIds'] as const;

export interface IotIdMigrationDeps {
  app: FastifyInstance;
  iot: IotManager;
  kinds: IotKind[];
}

export class IotIdMigrationService {
  constructor(private readonly deps: IotIdMigrationDeps) {}

  /** ¿Ya se aplicó? */
  private async alreadyDone(): Promise<boolean> {
    const row = await this.deps.app.prisma.setting.findUnique({ where: { key: DONE_KEY } });
    return row?.value === 'true';
  }

  private async markDone(): Promise<void> {
    await this.deps.app.prisma.setting.upsert({
      where: { key: DONE_KEY },
      update: { value: 'true' },
      create: { key: DONE_KEY, value: 'true' },
    });
  }

  /**
   * Recolecta todos los ids IoT persistidos hoy, de los siete sitios. Si mañana
   * aparece un octavo, `iot-id-sites.test.ts` lo caza: recorre el schema buscando
   * columnas que guarden ids de dispositivo IoT.
   */
  private async collectPersistedIds(): Promise<string[]> {
    const { prisma } = this.deps.app;
    const [members, scenes, schedules, favorites, energy, energyRules, alarm] = await Promise.all([
      prisma.iotRoomMember.findMany({ select: { iotDeviceId: true } }),
      prisma.scene.findMany({ select: { id: true, actions: true } }),
      prisma.iotSchedule.findMany({ select: { id: true, target: true } }),
      prisma.favorite.findMany({ where: { kind: 'iot' }, select: { ref: true } }),
      prisma.energySample.findMany({ select: { deviceId: true }, distinct: ['deviceId'] }),
      prisma.energyAlertRule.findMany({ select: { deviceId: true } }),
      prisma.setting.findUnique({ where: { key: 'alarm.config' } }),
    ]);

    const ids: string[] = [
      ...members.map((m) => m.iotDeviceId),
      ...favorites.map((f) => f.ref),
      ...energy.map((e) => e.deviceId),
      ...energyRules.map((r) => r.deviceId),
      ...scenes.flatMap((s) => idsInJson(s.actions)),
      ...schedules.flatMap((s) => idsInJson(s.target)),
      ...(alarm ? idsInJson(alarm.value) : []),
    ];
    return ids.filter(Boolean);
  }

  /** Aplica el plan a los siete sitios. Devuelve cuántas filas cambiaron. */
  private async apply(plan: MigrationPlan): Promise<number> {
    const { prisma } = this.deps.app;
    const { mapping } = plan;
    let changed = 0;

    // 1. Habitaciones (el id es la PK: se borra y se recrea).
    for (const member of await prisma.iotRoomMember.findMany()) {
      const next = mapping.get(member.iotDeviceId);
      if (!next) continue;
      await prisma.$transaction([
        prisma.iotRoomMember.delete({ where: { iotDeviceId: member.iotDeviceId } }),
        prisma.iotRoomMember.create({ data: { iotDeviceId: next, roomId: member.roomId } }),
      ]);
      changed += 1;
    }

    // 2. Favoritos de tipo `iot`.
    for (const fav of await prisma.favorite.findMany({ where: { kind: 'iot' } })) {
      const next = mapping.get(fav.ref);
      if (!next) continue;
      // El índice único es (userId, kind, ref): si el destino ya existe, sobra.
      const clash = await prisma.favorite.findFirst({
        where: { userId: fav.userId, kind: 'iot', ref: next },
      });
      if (clash) await prisma.favorite.delete({ where: { id: fav.id } });
      else await prisma.favorite.update({ where: { id: fav.id }, data: { ref: next } });
      changed += 1;
    }

    // 3. Energía: muestras y reglas.
    for (const [from, to] of mapping) {
      const samples = await prisma.energySample.updateMany({
        where: { deviceId: from },
        data: { deviceId: to },
      });
      const rules = await prisma.energyAlertRule.updateMany({
        where: { deviceId: from },
        data: { deviceId: to },
      });
      changed += samples.count + rules.count;
    }

    // 4. JSON: escenas, horarios IoT y la config de la alarma.
    for (const scene of await prisma.scene.findMany()) {
      const next = remapJson(scene.actions, mapping);
      if (next === scene.actions) continue;
      await prisma.scene.update({ where: { id: scene.id }, data: { actions: next } });
      changed += 1;
    }
    for (const schedule of await prisma.iotSchedule.findMany()) {
      const next = remapJson(schedule.target, mapping);
      if (next === schedule.target) continue;
      await prisma.iotSchedule.update({ where: { id: schedule.id }, data: { target: next } });
      changed += 1;
    }
    const alarm = await prisma.setting.findUnique({ where: { key: 'alarm.config' } });
    if (alarm) {
      const next = remapJson(alarm.value, mapping);
      if (next !== alarm.value) {
        await prisma.setting.update({ where: { key: 'alarm.config' }, data: { value: next } });
        changed += 1;
      }
    }

    return changed;
  }

  /**
   * Ejecuta la migración si no se hizo ya. **No propaga errores**: es trabajo de
   * arranque y el agente tiene que levantar igual — si falla, se registra y se
   * reintenta en el siguiente arranque (no se marca como hecha).
   */
  async run(): Promise<MigrationPlan | null> {
    const { app, iot, kinds } = this.deps;
    try {
      if (await this.alreadyDone()) return null;

      const persistedIds = await this.collectPersistedIds();
      if (persistedIds.length === 0) {
        // Instalación nueva: nada que reescribir, pero se marca para no volver a
        // mirar en cada arranque.
        await this.markDone();
        return null;
      }

      // Los aparatos vivos resuelven las instalaciones YA rotas; si el backend no
      // responde ahora, la regla del backend único sigue arreglando el caso común.
      const liveIds = await iot
        .listDevices()
        .then((devices) => devices.map((d) => d.id))
        .catch(() => [] as string[]);

      const plan = planIdMigration({ persistedIds, liveIds, kinds });
      if (plan.mapping.size === 0 && plan.unresolved.length === 0) {
        await this.markDone();
        return plan;
      }

      const changed = plan.mapping.size > 0 ? await this.apply(plan) : 0;
      await this.markDone();

      app.log.info(
        { remapped: plan.mapping.size, rows: changed, unresolved: plan.unresolved.length },
        '[iot] ids de dispositivo migrados al formato con prefijo (US-243)',
      );
      if (plan.unresolved.length > 0) {
        // Se dice en voz alta: son escenas/horarios que apuntan a algo que ya no
        // se puede identificar, y el usuario tiene que revisarlos a mano.
        app.log.warn(
          { unresolved: plan.unresolved },
          '[iot] hay ids que no se han podido resolver; revisa esas escenas/horarios a mano',
        );
      }
      app.audit({
        action: 'iot.ids_migrated',
        detail: `${plan.mapping.size} id(s), ${changed} fila(s), ${plan.unresolved.length} sin resolver`,
      });
      return plan;
    } catch (err) {
      // Sin marcar como hecha: se reintenta en el próximo arranque.
      app.log.error({ err }, '[iot] la migración de ids falló; se reintentará al arrancar');
      return null;
    }
  }
}

/** Ids de dispositivo que aparecen dentro de un JSON persistido. */
function idsInJson(raw: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node !== 'object' || node === null) return;
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if ((ID_KEYS as readonly string[]).includes(k)) {
        if (typeof v === 'string') out.push(v);
        else if (Array.isArray(v)) out.push(...v.filter((x): x is string => typeof x === 'string'));
      } else {
        walk(v);
      }
    }
  };
  walk(parsed);
  return out;
}

/** Reescribe los ids de un JSON persistido. */
function remapJson(raw: string, mapping: Map<string, string>): string {
  return remapIdsInJson(raw, ID_KEYS, mapping);
}
