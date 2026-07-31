import type { IotKind } from '@krakenos/types';

/**
 * Migración **pura** de ids IoT persistidos (US-243).
 *
 * ## El fallo que cierra
 *
 * `createIotManager` devolvía el manager **directo** con un solo backend y lo
 * envolvía en `CompositeIotManager` a partir de dos — y el composite **prefija**
 * cada id (`hue:foco-1`). Esos ids se guardan **crudos y sin FK** en seis sitios
 * (`IotRoomMember.iotDeviceId`, `Scene.actions`, `IotSchedule.target`,
 * `Favorite.ref`, `EnergySample.deviceId`, `EnergyAlertRule.deviceId`) más
 * `alarm.config.sensorDeviceIds`.
 *
 * Consecuencia: **el camino natural del usuario —«empiezo con Hue, luego añado los
 * Tapo»— le vaciaba escenas, habitaciones, horarios, favoritos y el histórico de
 * energía, sin un solo error en pantalla.**
 *
 * ## El arreglo
 *
 * Prefijar **siempre**, también con un backend. Así el id no depende de cuántas
 * integraciones haya configuradas, que es la propiedad que faltaba. Pero eso deja
 * a las instalaciones existentes con ids crudos, así que hay que reescribirlos: es
 * lo que planifica este módulo.
 *
 * ⚠️ **Un id que contiene `:` no está necesariamente prefijado.** Un dispositivo
 * zigbee puede llamarse `0x00124b0022:sensor`, y tratar `0x00124b0022` como
 * prefijo lo dejaría fuera para siempre. Por eso se comprueba contra los **kinds
 * conocidos**, nunca contra «tiene dos puntos».
 */

/**
 * Prefijos reconocidos. Son los `IotKind` **vigentes más los retirados**: una
 * instalación vieja puede tener ids `switchbot:algo` persistidos y dejar de
 * reconocerlos volvería a prefijarlos (`mock:switchbot:algo`).
 */
export const IOT_KINDS: readonly string[] = [
  'mock',
  'zigbee',
  'matter',
  'hue',
  'govee',
  'tuya',
  'kasa',
  'shelly',
  'meross',
  // ⚠️ `switchbot` se conserva a propósito aunque US-242 borrara el backend: una
  // instalación vieja puede tener ids `switchbot:algo` persistidos, y dejar de
  // reconocerlos como prefijados haría que la migración se los volviera a prefijar.
  'switchbot',
];

const KIND_SET = new Set<string>(IOT_KINDS);

/** ¿Está el id ya prefijado por un backend conocido? */
export function isPrefixed(id: string): boolean {
  const i = id.indexOf(':');
  if (i <= 0) return false;
  return KIND_SET.has(id.slice(0, i));
}

/** Quita el prefijo conocido de un id, si lo tiene. */
export function stripPrefix(id: string): string {
  return isPrefixed(id) ? id.slice(id.indexOf(':') + 1) : id;
}

export interface MigrationPlanInput {
  /** Ids tal y como están hoy en la base de datos (con duplicados o sin ellos). */
  persistedIds: string[];
  /**
   * Ids **vivos** que reporta el manager ya prefijado. Es la fuente de verdad para
   * resolver a qué backend pertenece cada id crudo.
   */
  liveIds: string[];
  /** Kinds configurados ahora mismo, en orden. */
  kinds: IotKind[];
}

export interface MigrationPlan {
  /** id viejo → id nuevo. Solo entradas que cambian. */
  mapping: Map<string, string>;
  /**
   * Ids que **no se han podido resolver**: ni casan con un aparato vivo ni hay un
   * único backend que los explique. No se tocan y se reportan — inventar un
   * prefijo aquí sería apuntar la escena de alguien a un aparato que no es.
   */
  unresolved: string[];
}

/**
 * Decide cómo reescribir cada id persistido.
 *
 * Tres reglas, en orden:
 *
 * 1. **Ya prefijado con un kind conocido** → se deja. Es el caso de quien ya tenía
 *    dos backends.
 * 2. **Casa con un aparato vivo por sufijo** → se usa ese id vivo. Es el arreglo
 *    de las instalaciones ya rotas: el aparato existe, solo hay que volver a
 *    apuntarlo. Si casa con **más de uno** (dos backends con el mismo id interno)
 *    es ambiguo y no se toca.
 * 3. **Un solo backend configurado** → se prefija con él. Es el caso mayoritario:
 *    instalación de siempre, ids crudos, un backend. No hace falta que el aparato
 *    esté en línea para arreglarlo.
 *
 * Lo que no encaje en ninguna queda en `unresolved`.
 */
export function planIdMigration(input: MigrationPlanInput): MigrationPlan {
  const { persistedIds, liveIds, kinds } = input;
  const mapping = new Map<string, string>();
  const unresolved: string[] = [];

  // sufijo (id sin prefijo) → ids vivos que lo tienen.
  //
  // ⚠️ Solo entran los ids vivos **ya prefijados**: uno sin prefijo no dice a qué
  // backend pertenece, así que casarlo consigo mismo solo serviría para tapar la
  // regla 3 con un remapeo que no cambia nada.
  const liveBySuffix = new Map<string, string[]>();
  for (const live of liveIds) {
    if (!isPrefixed(live)) continue;
    const bare = stripPrefix(live);
    const list = liveBySuffix.get(bare);
    if (list) list.push(live);
    else liveBySuffix.set(bare, [live]);
  }

  for (const id of new Set(persistedIds)) {
    if (!id) continue;
    if (isPrefixed(id)) continue; // regla 1

    const matches = liveBySuffix.get(id) ?? [];
    if (matches.length === 1) {
      mapping.set(id, matches[0]!); // regla 2
      continue;
    }
    if (matches.length > 1) {
      unresolved.push(id); // ambiguo: dos backends con el mismo id interno
      continue;
    }
    if (kinds.length === 1) {
      mapping.set(id, `${kinds[0]}:${id}`); // regla 3
      continue;
    }
    unresolved.push(id);
  }

  return { mapping, unresolved };
}

/** Aplica el mapa a un id suelto (identidad si no cambia). */
export function remapId(id: string, mapping: Map<string, string>): string {
  return mapping.get(id) ?? id;
}

/**
 * Reescribe los ids dentro de un JSON persistido (`Scene.actions`,
 * `IotSchedule.target`, `alarm.config.sensorDeviceIds`) sin conocer su forma:
 * recorre el árbol y sustituye el valor de las claves indicadas.
 *
 * Se hace así **a propósito**: son tres shapes distintos que además cambian con el
 * tiempo (US-244 va a ampliar el contrato IoT), y una migración que solo entiende
 * la forma de hoy se rompe callada la próxima vez que alguien añada un campo.
 * Parseo defensivo (US-63): un JSON corrupto se deja **tal cual**.
 */
export function remapIdsInJson(
  raw: string,
  keys: readonly string[],
  mapping: Map<string, string>,
): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return raw;
  }
  const keySet = new Set(keys);
  let changed = false;

  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (typeof node !== 'object' || node === null) return node;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (keySet.has(k) && typeof v === 'string') {
        const next = mapping.get(v);
        if (next && next !== v) changed = true;
        out[k] = next ?? v;
      } else if (keySet.has(k) && Array.isArray(v)) {
        // Listas de ids sueltos (`sensorDeviceIds`).
        out[k] = v.map((item) => {
          if (typeof item !== 'string') return walk(item);
          const next = mapping.get(item);
          if (next && next !== item) changed = true;
          return next ?? item;
        });
      } else {
        out[k] = walk(v);
      }
    }
    return out;
  };

  const result = walk(parsed);
  return changed ? JSON.stringify(result) : raw;
}
