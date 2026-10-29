import { describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => {
  // `getList` delega en `get` para que los mocks por ruta que ya existen
  // sigan valiendo tal cual: es el mismo GET, con la forma comprobada.
  const get = vi.fn();
  return {
    get,
    getList: vi.fn((path: string) => get(path)),
    post: vi.fn(),
    patch: vi.fn(),
    del: vi.fn(),
  };
});
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError: class extends Error {} }));

import { t } from '@/lib/i18n';
import { Clapperboard, Sparkles } from 'lucide-react';
import { SCENE_ICONS, SCENE_TEMPLATES, createScene, runScene, sceneIcon } from '@/lib/scenes';

describe('lib/scenes (US-166)', () => {
  it('sceneIcon devuelve el componente del icono, o el genérico si es desconocido', () => {
    expect(sceneIcon('movie')).toBe(Clapperboard);
    expect(sceneIcon('inexistente' as never)).toBe(Sparkles);
  });

  it('el catálogo de iconos y las plantillas están bien formados', () => {
    expect(
      SCENE_ICONS.every((s) => s.Icon !== undefined && t(`scenes.icon.${s.icon}`).length > 0),
    ).toBe(true);
    expect(SCENE_TEMPLATES.map((tpl) => t(tpl.nameKey))).toContain('Buenas noches');
    // La plantilla de cine deja las luces tenues (encendidas al 20%).
    const cine = SCENE_TEMPLATES.find((tpl) => tpl.icon === 'movie');
    expect(cine?.preset).toEqual({ on: true, brightness: 20 });
  });

  it('los helpers llaman al endpoint correcto', () => {
    apiMock.post.mockResolvedValue({});
    createScene({ name: 'Noche', actions: [] });
    expect(apiMock.post).toHaveBeenCalledWith('/scenes', { name: 'Noche', actions: [] });
    runScene('s1');
    expect(apiMock.post).toHaveBeenCalledWith('/scenes/s1/run');
  });
});
