import type { IotSchedule, IotScheduleTarget, IotScheduleTime } from '@krakenos/types';
import type { IotSchedule as DbIotSchedule } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import {
  planDeAbsorcion,
  type HorarioOmitido,
} from '../../automations/absorb-schedules.js';

/**
 * Absorción **una sola vez** de los horarios IoT (US-168) por el motor de
 * automatizaciones (US-256).
 *
 * Hasta aquí una rutina podía vivir en tres pantallas con tres vocabularios, y
 * la de horarios era la única que sabía decir «al atardecer». Con el disparador
 * solar en el motor, un horario IoT es exactamente una regla: mismo momento
 * (`time`/`sun`), mismo objetivo (`iot-set`/`scene-run`). Lo que sobraba era la
 * segunda pantalla, no el segundo modelo.
 *
 * Corre **al arrancar** y se marca hecha en `Setting`, igual que la reescritura
 * de ids (US-243), porque necesita traducir JSON con forma —no cabe en una
 * migración SQL sin reimplementar el parseo defensivo en SQLite— y porque tiene
 * que convivir con filas corruptas.
 *
 * ⚠️ **No borra los horarios de origen.** La tabla `IotSchedule` queda como
 * archivo de solo lectura: sin rutas, sin UI y sin barrido, así que no puede
 * disparar dos veces. Borrar sería irreversible en la misma operación que la
 * traduce, y si algo se tradujo mal la única copia de lo que el usuario escribió
 * sería la que acabamos de pisar. La tabla se retira en su propia historia,
 * cuando la absorción lleve tiempo corriendo.
 */

/** Marca de idempotencia. Versionada por si hiciera falta una segunda pasada. */
const DONE_KEY = 'automations.absorbedIotSchedules.v1';

/**
 * Lectura de una fila, o `null` si no se puede leer.
 *
 * ⚠️ Aquí **no** vale el degradado del servicio que se retira. Al pintar una
 * lista, una fila corrupta se degradaba a valores inertes (`minute: 0`,
 * `deviceId: ''`) y se enseñaba deshabilitada; eso está bien para mirar y es
 * veneno para migrar, porque `minute: 0` **es una hora válida**: la fila
 * ilegible se convertiría en una rutina que dispara a medianoche y que nadie
 * escribió. Migrar exige distinguir «no se puede leer» de «dice cero».
 */
function leerHorario(row: DbIotSchedule): IotSchedule | null {
  let days: number[] = [];
  try {
    const parsed = JSON.parse(row.days) as number[];
    days = Array.isArray(parsed) ? parsed : [];
  } catch {
    days = [];
  }
  try {
    const time = JSON.parse(row.time) as IotScheduleTime;
    const target = JSON.parse(row.target) as IotScheduleTarget;
    if (typeof time?.kind !== 'string' || typeof target?.type !== 'string') return null;
    return {
      id: row.id,
      name: row.name,
      enabled: row.enabled,
      days,
      time,
      target,
      createdAt: row.createdAt.toISOString(),
    };
  } catch {
    return null;
  }
}

export class ScheduleAbsorptionService {
  constructor(private readonly app: FastifyInstance) {}

  private async alreadyDone(): Promise<boolean> {
    const row = await this.app.prisma.setting.findUnique({ where: { key: DONE_KEY } });
    return row?.value === 'true';
  }

  /**
   * Absorbe si no se hizo ya. **No propaga errores**: es trabajo de arranque y
   * el agente tiene que levantar igual — si falla, se registra y se reintenta en
   * el arranque siguiente, porque la marca solo se escribe con el trabajo hecho.
   *
   * Devuelve cuántas reglas creó, o `null` si no había nada que hacer.
   */
  async run(): Promise<number | null> {
    const { app } = this;
    try {
      if (await this.alreadyDone()) return null;

      const rows = await app.prisma.iotSchedule.findMany({ orderBy: { createdAt: 'asc' } });
      const legibles: IotSchedule[] = [];
      const ilegibles: HorarioOmitido[] = [];
      for (const row of rows) {
        const horario = leerHorario(row);
        if (horario) legibles.push(horario);
        else
          ilegibles.push({
            origen: row.id,
            nombre: row.name,
            motivo: 'la fila no se puede leer',
          });
      }

      const plan = planDeAbsorcion(legibles);
      const { absorbidos } = plan;
      const omitidos = [...ilegibles, ...plan.omitidos];

      // La creación y la marca van en la MISMA transacción: si el proceso muere
      // entre ambas, el arranque siguiente volvería a crear las reglas ya
      // creadas y el usuario acabaría con cada rutina duplicada.
      await app.prisma.$transaction(async (tx) => {
        for (const { origen, regla } of absorbidos) {
          const source = rows.find((row) => row.id === origen);
          await tx.automationRule.create({
            data: {
              name: regla.name,
              enabled: regla.enabled ?? true,
              trigger: JSON.stringify(regla.trigger),
              actions: JSON.stringify(regla.actions),
              // Se conserva la fecha original: la lista de rutinas ordena por
              // creación, y darles la de hoy las pondría todas al final, juntas
              // y en un orden que el usuario no reconoce.
              ...(source ? { createdAt: source.createdAt } : {}),
            },
          });
        }
        await tx.setting.upsert({
          where: { key: DONE_KEY },
          update: { value: 'true' },
          create: { key: DONE_KEY, value: 'true' },
        });
      });

      for (const omitido of omitidos) {
        app.log.warn(
          { schedule: omitido.origen, name: omitido.nombre },
          `[automations] horario no absorbido (${omitido.motivo}); su fila se conserva`,
        );
      }
      if (absorbidos.length > 0) {
        app.log.info(
          { absorbidos: absorbidos.length, omitidos: omitidos.length },
          '[automations] horarios IoT absorbidos como rutinas',
        );
        app.audit({
          action: 'automation.absorb_schedules',
          detail: `${absorbidos.length} horario(s) → rutinas · ${omitidos.length} omitido(s)`,
        });
      }
      return absorbidos.length;
    } catch (err) {
      app.log.error(
        { err },
        '[automations] falló la absorción de horarios IoT; se reintenta al arrancar',
      );
      return null;
    }
  }
}
