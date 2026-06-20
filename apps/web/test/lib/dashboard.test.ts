import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_LAYOUT,
  loadLayout,
  moveWidget,
  normalizeLayout,
  saveLayout,
  toggleHidden,
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
    const custom = { order: ['system', ...ALL.filter((i) => i !== 'system')] as WidgetId[], hidden: ['wifi'] as WidgetId[] };
    saveLayout(custom);
    const loaded = loadLayout();
    expect(loaded.order[0]).toBe('system');
    expect(loaded.hidden).toEqual(['wifi']);
  });

  it('loadLayout sin nada guardado devuelve el orden por defecto', () => {
    expect(loadLayout().order).toEqual(DEFAULT_LAYOUT.order);
  });
});
