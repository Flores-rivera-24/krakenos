import { describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError: class extends Error {} }));

import { t } from '@/lib/i18n';
import { SCENE_ICONS, SCENE_TEMPLATES, createScene, runScene, sceneGlyph } from '@/lib/scenes';

describe('lib/scenes (US-166)', () => {
  it('sceneGlyph devuelve el glifo, o el genérico si es desconocido', () => {
    expect(sceneGlyph('movie')).toBe('🎬');
    expect(sceneGlyph('inexistente' as never)).toBe('✨');
  });

  it('el catálogo de iconos y las plantillas están bien formados', () => {
    expect(SCENE_ICONS.every((s) => s.glyph.length > 0 && t(s.labelKey).length > 0)).toBe(true);
    expect(SCENE_TEMPLATES.map((tpl) => t(tpl.nameKey))).toContain('Buenas noches');
    // La plantilla de cine deja las luces tenues (encendidas al 20%).
    const cine = SCENE_TEMPLATES.find((t) => t.icon === 'movie');
    expect(cine?.preset).toEqual({ on: true, brightness: 20 });
  });

  it('los helpers llaman al endpoint correcto', () => {
    createScene({ name: 'Noche', actions: [] });
    expect(apiMock.post).toHaveBeenCalledWith('/scenes', { name: 'Noche', actions: [] });
    runScene('s1');
    expect(apiMock.post).toHaveBeenCalledWith('/scenes/s1/run');
  });
});
