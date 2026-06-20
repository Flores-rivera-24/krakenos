/** Identificadores estables de los widgets del dashboard (US-36). */
export type WidgetId =
  | 'topology'
  | 'traffic'
  | 'devices'
  | 'iot'
  | 'system'
  | 'alerts'
  | 'wifi';

export interface WidgetDef {
  id: WidgetId;
  title: string;
  /** Columnas que ocupa en el grid de 2 (1 = media fila, 2 = fila completa). */
  span: 1 | 2;
}

/** Registro de widgets disponibles, en su orden por defecto. */
export const WIDGETS: WidgetDef[] = [
  { id: 'devices', title: 'Dispositivos', span: 1 },
  { id: 'system', title: 'Sistema', span: 1 },
  { id: 'traffic', title: 'Tráfico WAN', span: 2 },
  { id: 'topology', title: 'Topología de red', span: 2 },
  { id: 'iot', title: 'IoT', span: 1 },
  { id: 'wifi', title: 'WiFi', span: 1 },
  { id: 'alerts', title: 'Alertas recientes', span: 1 },
];

const WIDGET_IDS = WIDGETS.map((w) => w.id);
const STORAGE_KEY = 'krakenos-dashboard-layout';

export interface DashboardLayout {
  /** Orden de los widgets por id. */
  order: WidgetId[];
  /** Ids de widgets ocultos. */
  hidden: WidgetId[];
}

export const DEFAULT_LAYOUT: DashboardLayout = { order: [...WIDGET_IDS], hidden: [] };

function isWidgetId(x: unknown): x is WidgetId {
  return typeof x === 'string' && (WIDGET_IDS as string[]).includes(x);
}

/**
 * Normaliza un layout contra el registro actual: descarta ids desconocidos y
 * **añade al final** los widgets nuevos que no estuvieran en el orden guardado
 * (para que aparezcan tras una actualización). `hidden` se filtra igual.
 */
export function normalizeLayout(layout: Partial<DashboardLayout>): DashboardLayout {
  const order = (layout.order ?? []).filter(isWidgetId);
  for (const id of WIDGET_IDS) if (!order.includes(id)) order.push(id);
  const hidden = (layout.hidden ?? []).filter(isWidgetId);
  return { order, hidden };
}

/** Carga el layout persistido en localStorage, o el por defecto. */
export function loadLayout(): DashboardLayout {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_LAYOUT, order: [...WIDGET_IDS] };
    return normalizeLayout(JSON.parse(raw) as Partial<DashboardLayout>);
  } catch {
    return { ...DEFAULT_LAYOUT, order: [...WIDGET_IDS] };
  }
}

/** Persiste el layout en localStorage. */
export function saveLayout(layout: DashboardLayout): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // almacenamiento no disponible: se ignora (el layout vive en memoria)
  }
}

/** Devuelve un layout con el widget movido una posición arriba/abajo. */
export function moveWidget(
  layout: DashboardLayout,
  id: WidgetId,
  dir: 'up' | 'down',
): DashboardLayout {
  const order = [...layout.order];
  const i = order.indexOf(id);
  const j = dir === 'up' ? i - 1 : i + 1;
  if (i === -1 || j < 0 || j >= order.length) return layout;
  [order[i], order[j]] = [order[j]!, order[i]!];
  return { ...layout, order };
}

/** Alterna la visibilidad de un widget. */
export function toggleHidden(layout: DashboardLayout, id: WidgetId): DashboardLayout {
  const hidden = layout.hidden.includes(id)
    ? layout.hidden.filter((h) => h !== id)
    : [...layout.hidden, id];
  return { ...layout, hidden };
}
