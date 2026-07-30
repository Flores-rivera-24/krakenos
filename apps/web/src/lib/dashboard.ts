/** Identificadores estables de los widgets del dashboard (US-36). */
export type WidgetId =
  | 'quickActions'
  | 'homeMode'
  | 'alarm'
  | 'scenes'
  | 'topology'
  | 'traffic'
  | 'devices'
  | 'iot'
  | 'system'
  | 'alerts'
  | 'wifi'
  | 'coverage';

export interface WidgetDef {
  id: WidgetId;
  title: string;
  /** Columnas que ocupa en el grid de 2 (1 = media fila, 2 = fila completa). */
  span: 1 | 2;
  /**
   * `true` = solo para quien opera la red. Se oculta a `kid`/`guest` y en **modo
   * sencillo** (US-176), igual que hace `navGroupsForRole` con el grupo «Red
   * avanzada» de la barra lateral.
   *
   * Sin esto (AUD3-28) el dashboard **ignoraba el rol y el modo**: los 12 widgets
   * se renderizaban para todos, así que un `kid` de 13 años aterrizaba en CPU,
   * RAM, uptime, topología y tráfico WAN — exactamente lo que el modo sencillo
   * oculta a dos clicks de distancia, en la misma sesión.
   */
  advancedOnly?: boolean;
}

/** Registro de widgets disponibles, en su orden por defecto. */
export const WIDGETS: WidgetDef[] = [
  { id: 'quickActions', title: 'Acciones rápidas', span: 2 },
  { id: 'homeMode', title: 'Modo del hogar', span: 2 },
  { id: 'alarm', title: 'Alarma', span: 2 },
  { id: 'scenes', title: 'Escenas', span: 2 },
  { id: 'devices', title: 'Dispositivos', span: 1 },
  { id: 'system', title: 'Sistema', span: 1, advancedOnly: true },
  { id: 'traffic', title: 'Tráfico WAN', span: 2, advancedOnly: true },
  { id: 'topology', title: 'Topología de red', span: 2, advancedOnly: true },
  { id: 'iot', title: 'IoT', span: 1 },
  { id: 'wifi', title: 'WiFi', span: 1 },
  { id: 'coverage', title: 'Cobertura WiFi', span: 1, advancedOnly: true },
  { id: 'alerts', title: 'Alertas recientes', span: 1, advancedOnly: true },
];

/**
 * Widgets que este usuario debe ver, según su rol y su modo de interfaz.
 *
 * Es **presentación**, igual que `navGroupsForRole` (US-176/179): la autoridad
 * sigue siendo del servidor en cada ruta. Ocultar el widget de Sistema no impide
 * llamar a `/api/system/stats`; lo que hace es no plantarle CPU y RAM en la cara
 * a quien no las va a usar nunca.
 */
export function widgetsForUser(role?: string, uiMode?: string): WidgetDef[] {
  // Mismos criterios que `navGroupsForRole` (US-176/179), a propósito: sería
  // incoherente que la barra lateral escondiera «Red avanzada» a un `member` y el
  // dashboard le plantara la topología de red en la primera pantalla.
  //   · `member`, `kid` y `guest` no ven lo avanzado.
  //   · el modo sencillo tampoco, sea cual sea el rol.
  //   · un rol desconocido o aún sin cargar ve todo, igual que la nav: filtrar por
  //     defecto haría parpadear el dashboard del admin en cada arranque.
  const restringido =
    role === 'member' || role === 'kid' || role === 'guest' || uiMode === 'simple';
  return restringido ? WIDGETS.filter((w) => !w.advancedOnly) : WIDGETS;
}

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
