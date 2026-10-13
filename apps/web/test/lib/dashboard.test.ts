import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_LAYOUT,
  loadLayout,
  moveWidget,
  normalizeLayout,
  saveLayout,
  toggleHidden,
  widgetsForUser,
  WIDGETS,
  type WidgetId,
} from '@/lib/dashboard';

const ALL = WIDGETS.map((w) => w.id);

describe('dashboard layout', () => {
  beforeEach(() => localStorage.clear());

  it('normalizeLayout descarta ids desconocidos y añade los nuevos al final', () => {
    const norm = normalizeLayout({ order: ['system', 'inexistente' as WidgetId], hidden: ['iot'] });
    expect(norm.order[0]).toBe('system');
    // Todos los widgets del registro acaban presentes.
    expect([...norm.order].sort()).toEqual([...ALL].sort());
    expect(norm.hidden).toEqual(['iot']);
  });

  it('moveWidget sube y baja respetando los límites', () => {
    const base = { order: ['devices', 'system', 'traffic'] as WidgetId[], hidden: [] };
    expect(moveWidget(base, 'system', 'up').order).toEqual(['system', 'devices', 'traffic']);
    expect(moveWidget(base, 'devices', 'up')).toBe(base); // ya está arriba: sin cambios
    expect(moveWidget(base, 'traffic', 'down')).toBe(base); // ya está abajo
  });

  it('toggleHidden alterna la visibilidad', () => {
    const base = { order: [...ALL], hidden: [] };
    const hidden = toggleHidden(base, 'iot');
    expect(hidden.hidden).toContain('iot');
    expect(toggleHidden(hidden, 'iot').hidden).not.toContain('iot');
  });

  it('saveLayout/loadLayout persisten y restauran el orden', () => {
    const custom = {
      order: ['system', ...ALL.filter((i) => i !== 'system')] as WidgetId[],
      hidden: ['wifi'] as WidgetId[],
    };
    saveLayout(custom);
    const loaded = loadLayout();
    expect(loaded.order[0]).toBe('system');
    expect(loaded.hidden).toEqual(['wifi']);
  });

  it('loadLayout sin nada guardado devuelve el orden por defecto', () => {
    expect(loadLayout().order).toEqual(DEFAULT_LAYOUT.order);
  });
});

describe('widgetsForUser y el widget de alertas', () => {
  const ids = (role?: string, mode?: string) => widgetsForUser(role, mode).map((w) => w.id);

  it('alerts (lee /audit, solo admin) no se ofrece a ningún rol que no sea admin', () => {
    for (const rol of ['viewer', 'member', 'kid', 'guest']) {
      expect(ids(rol)).not.toContain('alerts');
    }
  });

  it('alerts sí se ofrece al admin y a un rol aún sin cargar', () => {
    expect(ids('admin')).toContain('alerts');
    expect(ids(undefined)).toContain('alerts');
  });

  it('un viewer conserva el resto de lo que ya veía', () => {
    expect(ids('viewer')).toContain('system');
    expect(ids('viewer').length).toBe(WIDGETS.length - 1);
  });
});
