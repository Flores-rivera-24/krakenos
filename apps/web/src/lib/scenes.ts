import type {
  CaptureSceneRequest,
  CreateSceneRequest,
  Scene,
  SceneAction,
  SceneIcon,
  SceneRunResult,
  UpdateSceneRequest,
} from '@krakenos/types';
import { api } from '@/lib/api';
import type { TranslationKey } from '@/lib/i18n';

/** Catálogo de iconos de escena (US-166): glifo (emoji) + clave i18n de la etiqueta. */
export const SCENE_ICONS: { icon: SceneIcon; glyph: string; labelKey: TranslationKey }[] = [
  { icon: 'night', glyph: '🌙', labelKey: 'scene.icon.night' },
  { icon: 'movie', glyph: '🎬', labelKey: 'scene.icon.movie' },
  { icon: 'leave', glyph: '🚪', labelKey: 'scene.icon.leave' },
  { icon: 'morning', glyph: '🌅', labelKey: 'scene.icon.morning' },
  { icon: 'dinner', glyph: '🍽️', labelKey: 'scene.icon.dinner' },
  { icon: 'relax', glyph: '🛀', labelKey: 'scene.icon.relax' },
  { icon: 'party', glyph: '🎉', labelKey: 'scene.icon.party' },
  { icon: 'focus', glyph: '🎯', labelKey: 'scene.icon.focus' },
  { icon: 'scene', glyph: '✨', labelKey: 'scene.icon.scene' },
];

const GLYPH_BY_ICON = new Map(SCENE_ICONS.map((s) => [s.icon, s.glyph]));

/** Glifo del icono de una escena (cae al genérico si es desconocido). */
export function sceneGlyph(icon: SceneIcon): string {
  return GLYPH_BY_ICON.get(icon) ?? '✨';
}

/** Plantillas sugeridas al crear la primera escena (US-166). `preset` fija el estado. */
export interface SceneTemplate {
  /** Clave i18n del nombre por defecto que se sugiere al crear la escena. */
  nameKey: TranslationKey;
  icon: SceneIcon;
  /** Estado a aplicar a las luces incluidas al usar la plantilla. */
  preset: { on: boolean; brightness?: number };
}

export const SCENE_TEMPLATES: SceneTemplate[] = [
  { nameKey: 'scene.template.night', icon: 'night', preset: { on: false } },
  { nameKey: 'scene.template.movie', icon: 'movie', preset: { on: true, brightness: 20 } },
  { nameKey: 'scene.template.leave', icon: 'leave', preset: { on: false } },
];

export const listScenes = () => api.get<Scene[]>('/scenes');
export const createScene = (body: CreateSceneRequest) => api.post<Scene>('/scenes', body);
export const updateScene = (id: string, body: UpdateSceneRequest) =>
  api.patch<Scene>(`/scenes/${id}`, body);
export const deleteScene = (id: string) => api.del<void>(`/scenes/${id}`);
export const runScene = (id: string) => api.post<SceneRunResult>(`/scenes/${id}/run`);
export const captureScene = (body: CaptureSceneRequest) =>
  api.post<SceneAction[]>('/scenes/capture', body);
