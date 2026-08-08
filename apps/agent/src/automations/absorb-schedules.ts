import type {
  AutomationAction,
  AutomationTrigger,
  CreateAutomationRuleRequest,
  IotSchedule,
} from '@krakenos/types';

/**
 * Traducción **pura** de un horario IoT (US-168) a la regla de automatización
 * equivalente (US-256). Es la mitad decidible de la absorción: qué regla
 * corresponde a cada horario y cuáles no se pueden expresar. El acceso a la DB
 * vive en `modules/automations/absorb.service.ts`.
 *
 * La traducción es **sin pérdida** porque las dos formas coinciden campo a
 * campo: `days`+`time` es exactamente el disparador `time`/`sun`, y `target` es
 * exactamente la acción `iot-set`/`scene-run`. Los límites de ambos esquemas
 * también coinciden (nombre ≤ 60, desfase ±720, brillo 0-100), así que ninguna
 * regla traducida puede quedar fuera del esquema que la valida.
 *
 * Lo que **no** se puede expresar no se inventa: un horario sin días o sin
 * objetivo (los que `toSchedule` degrada al leer una fila corrupta) nunca llegó
 * a disparar, y darle días o un dispositivo para que «entre» sería fabricar una
 * rutina que el usuario no escribió. Se omite, se dice cuál, y su fila original
 * se queda donde está.
 */

/** Un horario traducido, con su origen para la traza. */
export interface HorarioAbsorbido {
  /** Id del `IotSchedule` de origen. Solo para el log; no viaja a la API. */
  origen: string;
  regla: CreateAutomationRuleRequest;
}

/** Un horario que no se puede expresar como regla, con el porqué. */
export interface HorarioOmitido {
  origen: string;
  nombre: string;
  motivo: string;
}

export interface PlanDeAbsorcion {
  absorbidos: HorarioAbsorbido[];
  omitidos: HorarioOmitido[];
}

/** Disparador equivalente al momento de un horario, o `null` si no lo tiene. */
function disparadorDe(schedule: IotSchedule): AutomationTrigger | null {
  const days = [...new Set(schedule.days)].sort((a, b) => a - b);
  if (days.length === 0) return null;
  if (schedule.time.kind === 'fixed') {
    return { type: 'time', days, minute: schedule.time.minute };
  }
  return { type: 'sun', event: schedule.time.kind, offsetMin: schedule.time.offsetMin, days };
}

/** Acción equivalente al objetivo de un horario, o `null` si no lo tiene. */
function accionDe(schedule: IotSchedule): AutomationAction | null {
  const { target } = schedule;
  if (target.type === 'scene') {
    return target.sceneId === '' ? null : { type: 'scene-run', sceneId: target.sceneId };
  }
  if (target.deviceId === '') return null;
  return {
    type: 'iot-set',
    deviceId: target.deviceId,
    // Se copian solo los campos presentes: un `on: undefined` explícito no es lo
    // mismo que «no tocar el interruptor», y el esquema no admite nulos.
    ...(target.on !== undefined ? { on: target.on } : {}),
    ...(target.brightness !== undefined ? { brightness: target.brightness } : {}),
  };
}

/** Qué horarios se convierten en reglas y cuáles no, sin tocar la base. */
export function planDeAbsorcion(schedules: IotSchedule[]): PlanDeAbsorcion {
  const absorbidos: HorarioAbsorbido[] = [];
  const omitidos: HorarioOmitido[] = [];

  for (const schedule of schedules) {
    const trigger = disparadorDe(schedule);
    if (!trigger) {
      omitidos.push({
        origen: schedule.id,
        nombre: schedule.name,
        motivo: 'sin días: no disparaba nunca',
      });
      continue;
    }
    const action = accionDe(schedule);
    if (!action) {
      omitidos.push({
        origen: schedule.id,
        nombre: schedule.name,
        motivo: 'sin objetivo: la fila estaba corrupta y ya venía deshabilitada',
      });
      continue;
    }
    absorbidos.push({
      origen: schedule.id,
      regla: {
        name: schedule.name,
        // Se respeta el estado original: un horario apagado no se enciende al
        // mudarse de sitio, y uno encendido sigue funcionando esa misma noche.
        enabled: schedule.enabled,
        trigger,
        actions: [action],
      },
    });
  }

  return { absorbidos, omitidos };
}
