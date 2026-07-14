/**
 * Detección de recintos cerrados ("habitaciones") a partir de las paredes
 * confirmadas de un plano (US-196).
 *
 * TODO ocurre en el navegador y es **puro**: sin deps, sin nube, determinista.
 * La entrada son segmentos de pared en METROS (origen arriba-izquierda) ya
 * confirmados por el usuario sobre el plano (US-195). La idea es la clásica
 * "flood-fill desde el exterior":
 *
 *   1. Rasterizamos las paredes sobre una rejilla booleana (celda = `cellM`).
 *   2. Inundamos desde el BORDE del plano por las celdas libres → "exterior".
 *   3. Lo que queda libre y NO es exterior son **recintos cerrados**: cada
 *      componente conexo es una habitación candidata (área, centroide, caja).
 *
 * El invariante honesto que NO se rompe: un plano ABIERTO (las paredes no
 * encierran nada) deja que todo el interior toque el borde → `[]`. No inventamos
 * habitaciones donde no hay un recinto realmente cerrado.
 *
 * Las paredes se engrosan un poco al rasterizar para que un hueco fino entre dos
 * extremos de pared no "gotee" y funda dos recintos en uno (o abra un recinto al
 * exterior). Es una aproximación por rejilla: las áreas salen con un pequeño
 * error de discretización, por eso los tests usan tolerancias.
 */

/** Segmento de pared en coordenadas del plano (METROS, origen arriba-izquierda). */
export interface PlanWall {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Habitación candidata detectada como recinto cerrado. */
export interface RoomCandidate {
  /** Área estimada en m². */
  areaM2: number;
  /** Centroide (metros). */
  cx: number;
  cy: number;
  /** Caja envolvente (metros). */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface EnclosureOptions {
  /** Tamaño de celda de la rejilla en metros (default 0.25). */
  cellM?: number;
  /** Área mínima de un recinto para contar como habitación, en m² (default 2). */
  minAreaM2?: number;
}

// ---- Constantes por defecto (afinadas contra los fixtures de test) ----

/** Tamaño de celda por defecto (m). 0.25 m equilibra precisión de área y coste. */
const DEFAULT_CELL_M = 0.25;
/** Área mínima por defecto (m²) para considerar un recinto una habitación. */
const DEFAULT_MIN_AREA_M2 = 2;
/**
 * Grosor de pared al rasterizar, en celdas a cada lado del trazo central. Con 1
 * (→ 3 celdas de ancho) un hueco de una sola celda entre dos extremos de pared no
 * deja escapar la inundación: paredes dibujadas como líneas 1px quedan estancas.
 */
const WALL_THICKNESS_CELLS = 1;

/** Redondea a un decimal (0.1), como el resto de superficies del sistema. */
function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/**
 * Superficie total del plano (m²) = extensión calibrada ancho×alto. Redondea a 0.1.
 * Valores no positivos → 0 (un plano sin calibrar no tiene superficie).
 */
export function estimatePlanArea(widthM: number, heightM: number): number {
  if (widthM <= 0 || heightM <= 0) return 0;
  return round1(widthM * heightM);
}

/**
 * Marca en la rejilla (booleana, row-major, `cols`×`rows`) todas las celdas que
 * cruza el segmento `wall`, engrosadas `WALL_THICKNESS_CELLS` a cada lado. Se
 * muestrea a lo largo del segmento en pasos de media celda para no dejar huecos
 * en diagonales, y por cada muestra se pinta un pequeño cuadrado de grosor.
 */
function rasterizeWall(
  grid: Uint8Array,
  cols: number,
  rows: number,
  cellM: number,
  wall: PlanWall,
): void {
  const dx = wall.x2 - wall.x1;
  const dy = wall.y2 - wall.y1;
  const lenM = Math.hypot(dx, dy);
  // Muestreo en pasos de ~media celda: garantiza celdas contiguas.
  const steps = Math.max(1, Math.ceil((lenM / cellM) * 2));

  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const mx = wall.x1 + dx * t;
    const my = wall.y1 + dy * t;
    const cxCell = Math.floor(mx / cellM);
    const cyCell = Math.floor(my / cellM);
    // Engrosa alrededor de la celda central para sellar huecos de 1px.
    for (let oy = -WALL_THICKNESS_CELLS; oy <= WALL_THICKNESS_CELLS; oy++) {
      for (let ox = -WALL_THICKNESS_CELLS; ox <= WALL_THICKNESS_CELLS; ox++) {
        const gx = cxCell + ox;
        const gy = cyCell + oy;
        if (gx < 0 || gy < 0 || gx >= cols || gy >= rows) continue;
        grid[gy * cols + gx] = WALL;
      }
    }
  }
}

// Estados de una celda en el mapa de inundación.
const FREE = 0; // libre, aún sin clasificar
const WALL = 1; // ocupada por pared
const OUTSIDE = 2; // libre pero conectada al borde (exterior)
const ROOM = 3; // libre y encerrada, ya asignada a un recinto

/**
 * Inunda (4-conexión) desde toda celda libre del BORDE marcándola como exterior.
 * Al terminar, las celdas que sigan `FREE` son las verdaderamente encerradas.
 * Usa una pila explícita (planos grandes → sin recursión y sin desbordar).
 */
function floodOutside(cells: Uint8Array, cols: number, rows: number): void {
  const stack: number[] = [];
  const pushIfFree = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= cols || y >= rows) return;
    const idx = y * cols + x;
    if (cells[idx] === FREE) {
      cells[idx] = OUTSIDE;
      stack.push(idx);
    }
  };

  // Siembra todo el borde.
  for (let x = 0; x < cols; x++) {
    pushIfFree(x, 0);
    pushIfFree(x, rows - 1);
  }
  for (let y = 0; y < rows; y++) {
    pushIfFree(0, y);
    pushIfFree(cols - 1, y);
  }

  while (stack.length > 0) {
    const idx = stack.pop();
    if (idx === undefined) break;
    const x = idx % cols;
    const y = (idx - x) / cols;
    pushIfFree(x - 1, y);
    pushIfFree(x + 1, y);
    pushIfFree(x, y - 1);
    pushIfFree(x, y + 1);
  }
}

/**
 * Extrae el componente conexo (4-conexión) de celdas `FREE` que contiene `(sx,sy)`,
 * marcándolas `ROOM`, y devuelve el candidato con área, centroide y caja envolvente
 * (todo en metros; el centro de una celda es su índice + 0.5).
 */
function collectRoom(
  cells: Uint8Array,
  cols: number,
  rows: number,
  cellM: number,
  sx: number,
  sy: number,
): RoomCandidate {
  const stack: number[] = [sy * cols + sx];
  cells[sy * cols + sx] = ROOM;

  let count = 0;
  let sumX = 0;
  let sumY = 0;
  let minCx = Infinity;
  let minCy = Infinity;
  let maxCx = -Infinity;
  let maxCy = -Infinity;

  const visit = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= cols || y >= rows) return;
    const idx = y * cols + x;
    if (cells[idx] === FREE) {
      cells[idx] = ROOM;
      stack.push(idx);
    }
  };

  while (stack.length > 0) {
    const idx = stack.pop();
    if (idx === undefined) break;
    const x = idx % cols;
    const y = (idx - x) / cols;
    // Centro de la celda en metros.
    const centerX = (x + 0.5) * cellM;
    const centerY = (y + 0.5) * cellM;
    count++;
    sumX += centerX;
    sumY += centerY;
    if (centerX < minCx) minCx = centerX;
    if (centerY < minCy) minCy = centerY;
    if (centerX > maxCx) maxCx = centerX;
    if (centerY > maxCy) maxCy = centerY;

    visit(x - 1, y);
    visit(x + 1, y);
    visit(x, y - 1);
    visit(x, y + 1);
  }

  const areaM2 = round1(count * cellM * cellM);
  return {
    areaM2,
    cx: round1(sumX / count),
    cy: round1(sumY / count),
    minX: round1(minCx),
    minY: round1(minCy),
    maxX: round1(maxCx),
    maxY: round1(maxCy),
  };
}

/**
 * Detecta recintos cerrados por las paredes y los devuelve como habitaciones
 * candidatas (mayor a menor área). Vacío si nada está cerrado.
 */
export function detectEnclosures(
  walls: PlanWall[],
  widthM: number,
  heightM: number,
  opts: EnclosureOptions = {},
): RoomCandidate[] {
  const cellM = opts.cellM ?? DEFAULT_CELL_M;
  const minAreaM2 = opts.minAreaM2 ?? DEFAULT_MIN_AREA_M2;
  if (widthM <= 0 || heightM <= 0 || cellM <= 0) return [];

  const cols = Math.ceil(widthM / cellM);
  const rows = Math.ceil(heightM / cellM);
  if (cols <= 0 || rows <= 0) return [];

  // 1. Rasteriza las paredes.
  const cells = new Uint8Array(cols * rows); // 0 = FREE por defecto
  for (const wall of walls) rasterizeWall(cells, cols, rows, cellM, wall);

  // 2. Inunda el exterior desde el borde.
  floodOutside(cells, cols, rows);

  // 3. Cada componente FREE restante es un recinto cerrado.
  const candidates: RoomCandidate[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (cells[y * cols + x] === FREE) {
        const room = collectRoom(cells, cols, rows, cellM, x, y);
        if (room.areaM2 >= minAreaM2) candidates.push(room);
      }
    }
  }

  // 4. Mayor a menor área.
  candidates.sort((a, b) => b.areaM2 - a.areaM2);
  return candidates;
}

/** ¿Está el punto (metros) dentro de la caja envolvente del candidato? (aprox.) */
export function apInCandidate(ap: { x: number; y: number }, c: RoomCandidate): boolean {
  return ap.x >= c.minX && ap.x <= c.maxX && ap.y >= c.minY && ap.y <= c.maxY;
}
