import type { BlockReason } from './access.js';
import type { Id, IsoDateTime } from './common.js';

/**
 * Personas del hogar (US-240): el control parental **por quien es, no por MAC**.
 *
 * El dato ya existía (`Device.ownerId`, US-179) pero solo se usaba para presencia
 * (US-169) y bienestar (US-184); cortar internet seguía siendo una operación por
 * dispositivo, así que «quitarle internet a Marta» eran seis acciones distintas
 * sobre seis MACs que hay que saberse. Aquí la unidad es la persona y el fan-out a
 * sus dispositivos lo hace el servidor.
 *
 * **Las tres formas de cortar internet son independientes y se acumulan** (la
 * evaluación vive en `access/blocked-eval.ts`):
 *
 * | Forma | Qué es | Cuándo vuelve |
 * |---|---|---|
 * | Pausa | corte temporal de un toque | sola, al cumplirse los minutos |
 * | Horario | ventana recurrente semanal | sola, al terminar la ventana |
 * | Bloqueo | corte manual indefinido | solo si alguien lo quita |
 */

/** Un dispositivo dentro de la vista de una persona. **Sin MAC ni IP**: ver nota abajo. */
export interface PersonDevice {
  /** `Device.id` — la MAC no sale en esta vista (es PII y aquí no hace falta). */
  id: Id;
  /** `label ?? hostname ?? «Dispositivo xxxxxx»`. */
  name: string;
  online: boolean;
  /** Bloqueo **efectivo**: manual OR horario OR pausa. */
  blocked: boolean;
  /** Todas las razones que aplican ahora, en orden estable. */
  reasons: BlockReason[];
  /** Fin de la pausa viva, si la hay. */
  pausedUntil: IsoDateTime | null;
}

/**
 * «Hora de dormir» de una persona: **una** ventana recurrente que se aplica a
 * todos sus dispositivos. Por debajo son N `AccessSchedule` (uno por MAC) atados
 * con `personId`; los horarios sueltos por dispositivo siguen existiendo aparte.
 */
export interface PersonBedtime {
  enabled: boolean;
  /** Días en que EMPIEZA la ventana: 0=domingo … 6=sábado. */
  days: number[];
  /** Minutos desde medianoche (0–1439) del inicio. */
  startMinute: number;
  /** Minutos desde medianoche (0–1439) del fin. Si ≤ start, cruza medianoche. */
  endMinute: number;
  /**
   * A cuántos dispositivos de la persona está aplicada ahora mismo. Si es menor
   * que su `deviceCount`, la UI lo dice en vez de fingir que cubre todo: un
   * dispositivo nuevo entra sin horario hasta que se vuelve a guardar.
   */
  appliedTo: number;
}

/** Una persona del hogar con sus dispositivos y su estado de acceso. */
export interface PersonSummary {
  /** `User.id`, o `null` para el grupo de dispositivos sin dueño. */
  userId: Id | null;
  /** `User.displayName`, o «Sin asignar». Nunca el email (US-85). */
  name: string;
  /** Rol del hogar (`USER_ROLES`), o `null` en el grupo sin dueño. */
  role: string | null;
  /** Dispositivos de la persona, en orden estable por nombre. */
  devices: PersonDevice[];
  /** Cuántos de sus dispositivos están en línea. */
  onlineCount: number;
  /** Cuántos están sin internet ahora mismo (por cualquiera de las tres formas). */
  blockedCount: number;
  /** Fin de pausa más lejano entre sus dispositivos, si hay alguna pausa viva. */
  pausedUntil: IsoDateTime | null;
  /** Su «hora de dormir», o `null` si no tiene. */
  bedtime: PersonBedtime | null;
}

/** Respuesta de `GET /api/people`. */
export interface PeopleResponse {
  people: PersonSummary[];
  /**
   * ¿Ve el solicitante el hogar entero? Un no-admin solo se ve a sí mismo
   * (misma regla que el bienestar, US-184) y la UI lo dice en vez de dar a
   * entender que la casa tiene una sola persona.
   */
  fullHome: boolean;
  /**
   * Dispositivos del inventario **sin dueño**. Sirve para el estado vacío honesto:
   * sin dueños asignados esta pantalla no puede hacer nada, y el arreglo está en
   * el detalle de cada dispositivo, no aquí.
   */
  unassignedDevices: number;
}

/** Cuerpo de `POST /api/people/:id/pause`. */
export interface PausePersonRequest {
  minutes: number;
}

/** Cuerpo de `PUT /api/people/:id/bedtime`. */
export interface SetBedtimeRequest {
  days: number[];
  startMinute: number;
  endMinute: number;
  enabled?: boolean;
}

/**
 * Resultado de una acción de persona sobre N dispositivos. Es **best-effort** y lo
 * dice: el driver puede fallar en unos y no en otros, y prometer «hecho» cuando
 * dos de seis siguieron con internet sería la clase de mentira que la Fase 7 vino
 * a quitar.
 */
export interface PersonActionResult {
  /** Dispositivos sobre los que se aplicó con éxito. */
  applied: number;
  /** Dispositivos que fallaron (el driver no respondió). */
  failed: number;
  /** Fin de la pausa, en las acciones de pausa. */
  pausedUntil?: IsoDateTime;
}
