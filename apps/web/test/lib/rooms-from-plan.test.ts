import { describe, expect, it } from 'vitest';

import {
  apInCandidate,
  detectEnclosures,
  estimatePlanArea,
  type PlanWall,
  type RoomCandidate,
} from '@/lib/rooms-from-plan';

/** Helper legible para construir un segmento de pared (metros). */
const wall = (x1: number, y1: number, x2: number, y2: number): PlanWall => ({ x1, y1, x2, y2 });

/** Un rectángulo cerrado de 4 paredes con esquinas (x0,y0)-(x1,y1). */
function box(x0: number, y0: number, x1: number, y1: number): PlanWall[] {
  return [
    wall(x0, y0, x1, y0), // arriba
    wall(x0, y1, x1, y1), // abajo
    wall(x0, y0, x0, y1), // izquierda
    wall(x1, y0, x1, y1), // derecha
  ];
}

/** ¿`actual` a menos de `rel` (fracción) de `expected`? La rejilla es aproximada. */
function within(actual: number, expected: number, rel: number): boolean {
  return Math.abs(actual - expected) <= expected * rel;
}

/** ¿El centroide del candidato cae dentro de su propia caja envolvente? */
function centroidInside(c: RoomCandidate): boolean {
  return c.cx >= c.minX && c.cx <= c.maxX && c.cy >= c.minY && c.cy <= c.maxY;
}

describe('estimatePlanArea', () => {
  it('multiplica ancho por alto', () => {
    expect(estimatePlanArea(10, 8)).toBe(80);
  });

  it('redondea a 0.1', () => {
    // 3.33 × 3 = 9.99 → 10.0
    expect(estimatePlanArea(3.33, 3)).toBe(10);
    // 2.5 × 1.05 = 2.625 → 2.6
    expect(estimatePlanArea(2.5, 1.05)).toBe(2.6);
  });

  it('devuelve 0 con dimensiones no positivas', () => {
    expect(estimatePlanArea(0, 8)).toBe(0);
    expect(estimatePlanArea(10, -1)).toBe(0);
  });
});

describe('detectEnclosures', () => {
  it('detecta dos habitaciones cerradas separadas por un tabique', () => {
    // Perímetro (0.5..9.5, 0.5..7.5) partido por un tabique vertical en x=5.
    const walls: PlanWall[] = [
      ...box(0.5, 0.5, 9.5, 7.5),
      wall(5, 0.5, 5, 7.5),
    ];

    const rooms = detectEnclosures(walls, 10, 8);
    expect(rooms).toHaveLength(2);

    // Área interior aproximada de cada mitad ≈ 23.4 m² (perímetro y tabique
    // comen grosor). Tolerancia ±20% por la discretización de la rejilla.
    for (const room of rooms) {
      expect(within(room.areaM2, 23.4, 0.2)).toBe(true);
      expect(centroidInside(room)).toBe(true);
    }

    // Ordenadas de mayor a menor área.
    expect(rooms[0]!.areaM2).toBeGreaterThanOrEqual(rooms[1]!.areaM2);

    // Un centroide vive a la izquierda del tabique y el otro a la derecha.
    const xs = rooms.map((r) => r.cx).sort((a, b) => a - b);
    expect(xs[0]!).toBeLessThan(5);
    expect(xs[1]!).toBeGreaterThan(5);
  });

  it('detecta una sola habitación como rectángulo cerrado interior', () => {
    const walls = box(2, 2, 8, 6); // 6×4 m de centro a centro
    const rooms = detectEnclosures(walls, 10, 8);

    expect(rooms).toHaveLength(1);
    const room = rooms[0]!;
    // Interior aproximado ≈ 17.1 m² (6×4 menos grosor de pared).
    expect(within(room.areaM2, 17.1, 0.2)).toBe(true);
    expect(centroidInside(room)).toBe(true);
    // El centroide cae dentro del rectángulo de paredes.
    expect(room.cx).toBeGreaterThan(2);
    expect(room.cx).toBeLessThan(8);
    expect(room.cy).toBeGreaterThan(2);
    expect(room.cy).toBeLessThan(6);
  });

  it('un plano abierto (paredes sueltas) no encierra nada → []', () => {
    const walls: PlanWall[] = [
      wall(1, 1, 3, 1), // trazo horizontal suelto
      wall(5, 5, 5, 7), // trazo vertical suelto
    ];
    expect(detectEnclosures(walls, 10, 8)).toEqual([]);
  });

  it('sin paredes → []', () => {
    expect(detectEnclosures([], 10, 8)).toEqual([]);
  });

  it('minAreaM2 descarta un recinto diminuto', () => {
    // Cajita cerrada de ~1.5×1.5 m → interior ~0.6 m².
    const walls = box(1, 1, 2.5, 2.5);

    // Con el umbral por defecto (2 m²) se descarta.
    expect(detectEnclosures(walls, 6, 6)).toEqual([]);

    // Bajando el umbral, aparece.
    const rooms = detectEnclosures(walls, 6, 6, { minAreaM2: 0.1 });
    expect(rooms).toHaveLength(1);
    expect(rooms[0]!.areaM2).toBeGreaterThan(0);
    expect(rooms[0]!.areaM2).toBeLessThan(2);
  });
});

describe('apInCandidate', () => {
  const c: RoomCandidate = {
    areaM2: 20,
    cx: 3,
    cy: 3,
    minX: 1,
    minY: 1,
    maxX: 5,
    maxY: 5,
  };

  it('un punto dentro de la caja → true', () => {
    expect(apInCandidate({ x: 3, y: 3 }, c)).toBe(true);
    expect(apInCandidate({ x: 1, y: 5 }, c)).toBe(true); // en el borde
  });

  it('un punto fuera de la caja → false', () => {
    expect(apInCandidate({ x: 0, y: 3 }, c)).toBe(false);
    expect(apInCandidate({ x: 3, y: 6 }, c)).toBe(false);
  });
});
