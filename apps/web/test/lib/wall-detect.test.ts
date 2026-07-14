import { describe, expect, it } from 'vitest';
import {
  detectWalls,
  detectWallsAsync,
  type DetectedWall,
  type GrayImage,
} from '@/lib/wall-detect';

// ---- Utilidades de fixture: se dibuja sobre un lienzo blanco (255) y se oscurece ----

const DARK = 20; // tinta de pared
const WHITE = 255; // fondo

function blank(width: number, height: number): GrayImage {
  const data = new Uint8Array(width * height).fill(WHITE);
  return { data, width, height };
}

function set(img: GrayImage, x: number, y: number, v: number) {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  img.data[y * img.width + x] = v;
}

function hLine(img: GrayImage, y: number, x0: number, x1: number, v = DARK) {
  for (let x = x0; x <= x1; x++) set(img, x, y, v);
}

function vLine(img: GrayImage, x: number, y0: number, y1: number, v = DARK) {
  for (let y = y0; y <= y1; y++) set(img, x, y, v);
}

/** ¿Hay alguna pared horizontal cerca de `y` que cubra el rango [x0,x1]? (normalizado) */
function hasHorizontalNear(walls: DetectedWall[], y: number, x0: number, x1: number, tol = 0.03) {
  return walls.some(
    (w) =>
      Math.abs(w.y1 - w.y2) < 0.01 &&
      Math.abs((w.y1 + w.y2) / 2 - y) <= tol &&
      Math.min(w.x1, w.x2) <= x0 + tol &&
      Math.max(w.x1, w.x2) >= x1 - tol,
  );
}

function hasVerticalNear(walls: DetectedWall[], x: number, y0: number, y1: number, tol = 0.03) {
  return walls.some(
    (w) =>
      Math.abs(w.x1 - w.x2) < 0.01 &&
      Math.abs((w.x1 + w.x2) / 2 - x) <= tol &&
      Math.min(w.y1, w.y2) <= y0 + tol &&
      Math.max(w.y1, w.y2) >= y1 - tol,
  );
}

const isHorizontal = (w: DetectedWall) => Math.abs(w.y1 - w.y2) < 0.01;

describe('detectWalls — plano limpio', () => {
  it('detecta las 4 paredes de un rectángulo sobre fondo blanco', () => {
    const img = blank(200, 160);
    const left = 20;
    const right = 179;
    const top = 20;
    const bottom = 139;
    hLine(img, top, left, right);
    hLine(img, bottom, left, right);
    vLine(img, left, top, bottom);
    vLine(img, right, top, bottom);

    const walls = detectWalls(img);

    const mainWalls = [
      hasHorizontalNear(walls, top / img.height, left / img.width, right / img.width),
      hasHorizontalNear(walls, bottom / img.height, left / img.width, right / img.width),
      hasVerticalNear(walls, left / img.width, top / img.height, bottom / img.height),
      hasVerticalNear(walls, right / img.width, top / img.height, bottom / img.height),
    ];
    const found = mainWalls.filter(Boolean).length;
    expect(found).toBeGreaterThanOrEqual(4 * 0.8); // ≥80% de las paredes principales
  });
});

describe('detectWalls — no inventa (crítico)', () => {
  it('imagen en blanco → sin segmentos', () => {
    expect(detectWalls(blank(200, 160))).toEqual([]);
  });

  it('imagen totalmente blanca de otro tamaño → sin segmentos', () => {
    expect(detectWalls(blank(64, 64))).toEqual([]);
  });

  it('ruido disperso (píxeles oscuros sueltos, sin líneas) → sin segmentos largos', () => {
    const img = blank(200, 160);
    // Ruido determinista: un píxel oscuro cada tanto, nunca contiguos en largo.
    let seed = 12345;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let i = 0; i < 400; i++) {
      const x = Math.floor(rnd() * img.width);
      const y = Math.floor(rnd() * img.height);
      set(img, x, y, DARK);
    }
    const walls = detectWalls(img);
    expect(walls).toEqual([]);
  });
});

describe('detectWalls — línea única', () => {
  it('una línea horizontal larga → un segmento horizontal en la y correcta', () => {
    const img = blank(200, 120);
    const y = 60;
    hLine(img, y, 10, 189);

    const walls = detectWalls(img);
    const horizontals = walls.filter(isHorizontal);
    expect(horizontals.length).toBeGreaterThanOrEqual(1);

    const w = horizontals[0]!;
    expect(Math.abs((w.y1 + w.y2) / 2 - y / img.height)).toBeLessThan(0.02);
    expect(Math.min(w.x1, w.x2)).toBeLessThan(0.1);
    expect(Math.max(w.x1, w.x2)).toBeGreaterThan(0.9);
    expect(w.confidence).toBeGreaterThan(0.4);
  });
});

describe('detectWalls — fusión de paralelos', () => {
  it('una pared gruesa (3 filas adyacentes) no da 3 líneas paralelas', () => {
    const img = blank(200, 120);
    hLine(img, 59, 10, 189);
    hLine(img, 60, 10, 189);
    hLine(img, 61, 10, 189);

    const horizontals = detectWalls(img).filter(isHorizontal);
    expect(horizontals.length).toBe(1);
  });
});

describe('detectWalls — determinismo sync == async', () => {
  it('produce exactamente el mismo resultado que la variante asíncrona', async () => {
    const img = blank(120, 100);
    hLine(img, 20, 10, 109);
    hLine(img, 80, 10, 109);
    vLine(img, 10, 20, 80);
    vLine(img, 109, 20, 80);

    const sync = detectWalls(img);
    const async = await detectWallsAsync(img);
    expect(async).toEqual(sync);
  });
});

describe('detectWalls — opción minLength', () => {
  it('subir minLength descarta los segmentos cortos', () => {
    const img = blank(200, 160);
    hLine(img, 40, 10, 60); // corto (~25% del ancho)
    hLine(img, 100, 10, 189); // largo (casi todo el ancho)

    const relaxed = detectWalls(img, { minLength: 0.08 }).filter(isHorizontal);
    const strict = detectWalls(img, { minLength: 0.5 }).filter(isHorizontal);

    expect(relaxed.length).toBeGreaterThan(strict.length);
    // El corto desaparece con minLength alto; el largo sobrevive.
    expect(strict.length).toBeGreaterThanOrEqual(1);
    expect(
      strict.every((w) => Math.max(w.x1, w.x2) - Math.min(w.x1, w.x2) > 0.5),
    ).toBe(true);
  });
});
