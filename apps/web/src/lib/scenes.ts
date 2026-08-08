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

/** Catálogo de iconos de escena (US-166): glifo (emoji) + etiqueta en español. */
export const SCENE_ICONS: { icon: SceneIcon; glyph: string; label: string }[] = [
  { icon: 'night', glyph: '🌙', label: 'Buenas noches' },
  { icon: 'movie', glyph: '🎬', label: 'Cine' },
  { icon: 'leave', glyph: '🚪', label: 'Salir de casa' },
  { icon: 'morning', glyph: '🌅', label: 'Buenos días' },
  { icon: 'dinner', glyph: '🍽️', label: 'Cena' },
  { icon: 'relax', glyph: '🛀', label: 'Relax' },
  { icon: 'party', glyph: '🎉', label: 'Fiesta' },
  { icon: 'focus', glyph: '🎯', label: 'Concentración' },
  { icon: 'scene', glyph: '✨', label: 'Escena' },
];

const GLYPH_BY_ICON = new Map(SCENE_ICONS.map((s) => [s.icon, s.glyph]));

/** Glifo del icono de una escena (cae al genérico si es desconocido). */
export function sceneGlyph(icon: SceneIcon): string {
  return GLYPH_BY_ICON.get(icon) ?? '✨';
}

/** Plantillas sugeridas al crear la primera escena (US-166). `preset` fija el estado. */
export interface SceneTemplate {
  name: string;
  icon: SceneIcon;
  /** Estado a aplicar a las luces incluidas al usar la plantilla. */
  preset: { on: boolean; brightness?: number };
}

export const SCENE_TEMPLATES: SceneTemplate[] = [
  { name: 'Buenas noches', icon: 'night', preset: { on: false } },
  { name: 'Cine', icon: 'movie', preset: { on: true, brightness: 20 } },
  { name: 'Salir de casa', icon: 'leave', preset: { on: false } },
];

export const listScenes = () => api.getList<Scene>('/scenes');
export const createScene = (body: CreateSceneRequest) => api.post<Scene>('/scenes', body);
export const updateScene = (id: string, body: UpdateSceneRequest) =>
  api.patch<Scene>(`/scenes/${id}`, body);
export const deleteScene = (id: string) => api.del<void>(`/scenes/${id}`);
export const runScene = (id: string) => api.post<SceneRunResult>(`/scenes/${id}/run`);
export const captureScene = (body: CaptureSceneRequest) =>
  api.post<SceneAction[]>('/scenes/capture', body);
