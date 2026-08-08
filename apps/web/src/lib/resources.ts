import type {
  Device,
  FirewallRule,
  IotDevice,
  RoomWithState,
  Scene,
  SystemStats,
} from '@krakenos/types';
import { api } from '@/lib/api';
import { listRooms } from '@/lib/rooms';
import { listScenes } from '@/lib/scenes';
import { invalidarRecurso, useResource, type OpcionesRecurso } from '@/lib/use-resource';

/**
 * Las lecturas que **más de una pantalla comparte** (US-262).
 *
 * `useResource` promete que dos consumidores de la misma clave comparten
 * resultado, y esa promesa tiene una letra pequeña: la clave tiene que
 * determinar por completo qué se pide. Si un widget llamara
 * `useResource('/iot/devices', …)` con un fetcher y otro con uno distinto,
 * compartirían caché sin compartir significado, y el ganador sería el que montara
 * primero — un fallo que solo aparece según el orden de render y que no se
 * parecería nunca a su causa.
 *
 * Por eso las claves compartidas viven aquí, cada una con su fetcher pegado, y
 * los consumidores llaman al hook con nombre en vez de escribir la ruta. La
 * alternativa —confiar en que nadie teclee la ruta a mano— es la misma clase de
 * invariante sostenido por la memoria que el proyecto ya ha pagado dos veces.
 */

/** Claves de las lecturas compartidas. Se exportan para poder invalidarlas al escribir. */
export const CLAVES = {
  iotDevices: '/iot/devices',
  scenes: '/scenes',
  rooms: '/rooms',
  inventoryDevices: '/inventory/devices',
  systemStats: '/system/stats',
  firewallRules: '/firewall/rules',
} as const;

/**
 * Dispositivos IoT. La piden a la vez `QuickActionsWidget`, `IotStatusWidget` y
 * la barra lateral: era el `×3` que abría esta historia.
 */
export const useIotDevices = (opts?: OpcionesRecurso) =>
  useResource<IotDevice[]>(
    CLAVES.iotDevices,
    () => api.getList<IotDevice>(CLAVES.iotDevices),
    opts,
  );

/** Escenas. La piden `QuickActionsWidget` y `ScenesWidget` (era `×2`). */
export const useScenes = (opts?: OpcionesRecurso) =>
  useResource<Scene[]>(CLAVES.scenes, listScenes, opts);

/** Habitaciones con su estado. */
export const useRooms = (opts?: OpcionesRecurso) =>
  useResource<RoomWithState[]>(CLAVES.rooms, listRooms, opts);

/** Inventario de red. */
export const useInventoryDevices = (opts?: OpcionesRecurso) =>
  useResource<Device[]>(
    CLAVES.inventoryDevices,
    () => api.getList<Device>(CLAVES.inventoryDevices),
    opts,
  );

/** Estadísticas del sistema. Las piden `SystemWidget` y la barra lateral (era `×2`). */
export const useSystemStats = (opts?: OpcionesRecurso) =>
  useResource<SystemStats>(
    CLAVES.systemStats,
    () => api.get<SystemStats>(CLAVES.systemStats),
    opts,
  );

/** Reglas de cortafuegos (la barra lateral cuenta las activas). */
export const useFirewallRules = (opts?: OpcionesRecurso) =>
  useResource<FirewallRule[]>(
    CLAVES.firewallRules,
    () => api.getList<FirewallRule>(CLAVES.firewallRules),
    opts,
  );

/**
 * Invalida lo que una escritura sobre escenas deja obsoleto.
 *
 * Se nombra por la escritura y no por la clave a propósito: quien crea una escena
 * no tiene por qué saber qué pantallas la leen, y ese conocimiento envejece peor
 * repartido por los `onSubmit` que centralizado aquí.
 */
export function invalidarEscenas(): void {
  invalidarRecurso(CLAVES.scenes);
}

/** Invalida lo que deja obsoleto un cambio sobre un aparato IoT. */
export function invalidarIot(): void {
  invalidarRecurso(CLAVES.iotDevices);
}

/** Invalida lo que deja obsoleto un cambio sobre habitaciones. */
export function invalidarHabitaciones(): void {
  invalidarRecurso(CLAVES.rooms);
}
