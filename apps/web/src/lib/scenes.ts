import type {
  CaptureSceneRequest,
  CreateSceneRequest,
  Scene,
  SceneAction,
  SceneIcon,
  SceneRunResult,
  UpdateSceneRequest,
} from '@krakenos/types';
import {
  Bath,
  Clapperboard,
  DoorOpen,
  Moon,
  PartyPopper,
  Sparkles,
  Sunrise,
  Target,
  UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react';
import { api } from '@/lib/api';
import type { TranslationKey } from '@/lib/i18n';
import {
  invalidarEscenas,
  invalidarHabitaciones,
  invalidarIot,
  trasEscribir,
} from '@/lib/resources';

/**
 * Catálogo de iconos de escena (US-166): componente de lucide. El nombre visible de
 * cada icono vive en el catálogo i18n (`scenes.icon.<icon>`), no aquí.
 */
export const SCENE_ICONS: { icon: SceneIcon; Icon: LucideIcon }[] = [
  { icon: 'night', Icon: Moon },
  { icon: 'movie', Icon: Clapperboard },
  { icon: 'leave', Icon: DoorOpen },
  { icon: 'morning', Icon: Sunrise },
  { icon: 'dinner', Icon: UtensilsCrossed },
  { icon: 'relax', Icon: Bath },
  { icon: 'party', Icon: PartyPopper },
  { icon: 'focus', Icon: Target },
  { icon: 'scene', Icon: Sparkles },
];

const ICON_BY_KEY = new Map(SCENE_ICONS.map((s) => [s.icon, s.Icon]));

/** Icono de una escena (cae al genérico si es desconocido). */
export function sceneIcon(icon: SceneIcon): LucideIcon {
  return ICON_BY_KEY.get(icon) ?? Sparkles;
}

/** Plantillas sugeridas al crear la primera escena (US-166). `preset` fija el estado. */
export interface SceneTemplate {
  /**
   * Clave del nombre sugerido. El nombre que se GUARDA es el ya resuelto en el idioma
   * de quien crea la escena (es un dato suyo, no copy: no cambia si luego cambia de
   * idioma).
   */
  nameKey: TranslationKey;
  icon: SceneIcon;
  /** Estado a aplicar a las luces incluidas al usar la plantilla. */
  preset: { on: boolean; brightness?: number };
}

export const SCENE_TEMPLATES: SceneTemplate[] = [
  { nameKey: 'scenes.icon.night', icon: 'night', preset: { on: false } },
  { nameKey: 'scenes.icon.movie', icon: 'movie', preset: { on: true, brightness: 20 } },
  { nameKey: 'scenes.icon.leave', icon: 'leave', preset: { on: false } },
];

export const listScenes = () => api.getList<Scene>('/scenes');
// Las escrituras invalidan la caché compartida (`lib/resources.ts`) tras el éxito.
// Ejecutar una escena cambia aparatos y habitaciones, no escenas.
export const createScene = (body: CreateSceneRequest) =>
  trasEscribir(api.post<Scene>('/scenes', body), invalidarEscenas);
export const updateScene = (id: string, body: UpdateSceneRequest) =>
  trasEscribir(api.patch<Scene>(`/scenes/${id}`, body), invalidarEscenas);
export const deleteScene = (id: string) =>
  trasEscribir(api.del<void>(`/scenes/${id}`), invalidarEscenas);
export const runScene = (id: string) =>
  trasEscribir(api.post<SceneRunResult>(`/scenes/${id}/run`), invalidarIot, invalidarHabitaciones);
export const captureScene = (body: CaptureSceneRequest) =>
  api.post<SceneAction[]>('/scenes/capture', body);
