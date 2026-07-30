/**
 * Reconciliación **pura** de los horarios de persona contra el parque real de
 * dispositivos (US-240).
 *
 * El parental por persona guarda una fila `AccessSchedule` por MAC atada con
 * `personId`. Ese acoplamiento se desincroniza solo en cuanto el inventario se
 * mueve, y las dos direcciones tienen consecuencias muy distintas:
 *
 * - **Un aparato deja de ser de la persona** (cambia de dueño o se queda sin
 *   ninguno) y su fila sobrevive → el horario le **sigue cortando internet** a
 *   alguien que ya no lo eligió, sin nadie a quien atribuirlo en la UI. Es el
 *   fallo grave y el que esta función existe para cerrar.
 * - **Un aparato nuevo entra en la persona** y no recibe fila → la «hora de
 *   dormir» promete cubrir a la persona y deja un hueco. Es el fallo silencioso:
 *   nadie lo nota hasta que el niño descubre que la tablet nueva sí navega.
 *
 * Se resuelve con datos, sin reloj ni E/S, para poder probar ambas direcciones.
 */

/** Fila mínima de horario de persona. */
export interface PersonScheduleRow {
  id: string;
  mac: string;
  personId: string;
  name: string;
  enabled: boolean;
  /** JSON string tal cual está en la DB; se copia sin interpretar al clonar. */
  days: string;
  startMinute: number;
  endMinute: number;
}

/** Fila a crear (clon de la ventana de la persona sobre otra MAC). */
export interface PersonScheduleCreate {
  mac: string;
  personId: string;
  name: string;
  enabled: boolean;
  days: string;
  startMinute: number;
  endMinute: number;
}

export interface ReconcileInput {
  /** Todas las filas con `personId` no nulo. */
  rows: PersonScheduleRow[];
  /** Dueño **actual** de cada MAC del inventario (`null` = sin dueño). */
  ownerByMac: Map<string, string | null>;
}

export interface ReconcilePlan {
  /** Ids de filas que ya no corresponden a la persona. */
  deleteIds: string[];
  /** Filas que faltan para cubrir a todos los dispositivos de la persona. */
  create: PersonScheduleCreate[];
}

/**
 * Calcula qué sobra y qué falta. La ventana de las filas nuevas se **clona de una
 * fila existente de esa misma persona** (la primera por id, orden estable): no se
 * inventa nada, y si la persona ya no tiene ninguna fila es que no tiene hora de
 * dormir y no se crea nada.
 */
export function planPersonScheduleReconcile(input: ReconcileInput): ReconcilePlan {
  const { rows, ownerByMac } = input;

  // 1. Sobra todo lo que ya no case con el dueño actual de esa MAC. Una MAC que
  //    desapareció del inventario también sobra: sin dispositivo no hay a quién
  //    cortarle nada, y la fila quedaría huérfana para siempre.
  const deleteIds: string[] = [];
  const survivors: PersonScheduleRow[] = [];
  for (const row of rows) {
    if (ownerByMac.get(row.mac) === row.personId) survivors.push(row);
    else deleteIds.push(row.id);
  }

  // 2. Plantilla por persona: la primera fila superviviente, por id.
  const templateByPerson = new Map<string, PersonScheduleRow>();
  for (const row of [...survivors].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!templateByPerson.has(row.personId)) templateByPerson.set(row.personId, row);
  }

  // 3. Falta una fila por cada MAC de la persona que no la tenga ya.
  const coveredByPerson = new Map<string, Set<string>>();
  for (const row of survivors) {
    const set = coveredByPerson.get(row.personId) ?? new Set<string>();
    set.add(row.mac);
    coveredByPerson.set(row.personId, set);
  }

  const create: PersonScheduleCreate[] = [];
  for (const [mac, ownerId] of ownerByMac) {
    if (ownerId === null) continue;
    const template = templateByPerson.get(ownerId);
    if (!template) continue; // la persona no tiene hora de dormir
    if (coveredByPerson.get(ownerId)?.has(mac)) continue;
    create.push({
      mac,
      personId: ownerId,
      name: template.name,
      enabled: template.enabled,
      days: template.days,
      startMinute: template.startMinute,
      endMinute: template.endMinute,
    });
  }

  return { deleteIds, create };
}
