import type { ApPlacement, Wall, WallMaterial, WifiBand } from '@krakenos/types';
import { describe, expect, it } from 'vitest';
import {
  computePredictedHeatmap,
  fsplAt1m,
  pathLoss,
  rssiFromAp,
  segmentsIntersect,
  wallAttenuationDb,
  wallLossAlong,
} from '../../src/coverage/propagation.js';

function ap(partial: Partial<ApPlacement>): ApPlacement {
  return {
    id: 'ap1',
    apId: null,
    name: 'AP',
    x: 0,
    y: 0,
    txPowerDbm: 20,
    bands: ['2.4GHz', '5GHz', '6GHz'],
    enabled: true,
    ...partial,
  };
}

function wall(partial: Partial<Wall>): Wall {
  return {
    id: 'w1',
    x1: 0,
    y1: 0,
    x2: 1,
    y2: 1,
    material: 'concrete',
    ...partial,
  };
}

const ALL_BANDS: WifiBand[] = ['2.4GHz', '5GHz', '6GHz'];

describe('fsplAt1m', () => {
  // 20*log10(freqMHz) - 27.55
  const cases: Array<[WifiBand, number]> = [
    ['2.4GHz', 20 * Math.log10(2450) - 27.55],
    ['5GHz', 20 * Math.log10(5500) - 27.55],
    ['6GHz', 20 * Math.log10(6000) - 27.55],
  ];

  it.each(cases)('FSPL a 1 m para %s', (band, expected) => {
    expect(fsplAt1m(band)).toBeCloseTo(expected, 6);
  });

  it('valores numéricos concretos por banda', () => {
    expect(fsplAt1m('2.4GHz')).toBeCloseTo(40.2334, 3);
    expect(fsplAt1m('5GHz')).toBeCloseTo(47.2573, 3);
    expect(fsplAt1m('6GHz')).toBeCloseTo(48.013, 3);
  });

  it('banda más alta = más FSPL', () => {
    expect(fsplAt1m('2.4GHz')).toBeLessThan(fsplAt1m('5GHz'));
    expect(fsplAt1m('5GHz')).toBeLessThan(fsplAt1m('6GHz'));
  });
});

describe('pathLoss', () => {
  it('a la distancia mínima (1 m) iguala el FSPL a 1 m', () => {
    for (const band of ALL_BANDS) {
      expect(pathLoss(1, band, 3)).toBeCloseTo(fsplAt1m(band), 9);
    }
  });

  it('acota la distancia por debajo con minDistanceM (evita log(0))', () => {
    // d=0 y d=0.3 se acotan a minDistanceM=1 → igual que d=1
    expect(pathLoss(0, '5GHz', 3, 1)).toBeCloseTo(pathLoss(1, '5GHz', 3, 1), 9);
    expect(pathLoss(0.3, '5GHz', 3, 1)).toBeCloseTo(pathLoss(1, '5GHz', 3, 1), 9);
  });

  it('cae ~10*n dB por década de distancia', () => {
    for (const n of [2, 3, 3.5]) {
      const at1 = pathLoss(1, '5GHz', n);
      const at10 = pathLoss(10, '5GHz', n);
      const at100 = pathLoss(100, '5GHz', n);
      expect(at10 - at1).toBeCloseTo(10 * n, 6);
      expect(at100 - at10).toBeCloseTo(10 * n, 6);
    }
  });

  it('crece monótonamente con la distancia', () => {
    let prev = -Infinity;
    for (const d of [1, 2, 5, 10, 50]) {
      const pl = pathLoss(d, '5GHz', 3);
      expect(pl).toBeGreaterThan(prev);
      prev = pl;
    }
  });
});

describe('wallAttenuationDb', () => {
  it('valores base a 5 GHz (escala 1.0)', () => {
    const base: Array<[WallMaterial, number]> = [
      ['drywall', 3],
      ['wood', 4],
      ['glass', 6],
      ['brick', 8],
      ['concrete', 12],
      ['metal', 20],
    ];
    for (const [material, expected] of base) {
      expect(wallAttenuationDb(material, '5GHz')).toBeCloseTo(expected, 9);
    }
  });

  it('escala por banda: 2.4 GHz penetra mejor que 6 GHz', () => {
    expect(wallAttenuationDb('concrete', '2.4GHz')).toBeCloseTo(12 * 0.75, 9);
    expect(wallAttenuationDb('concrete', '5GHz')).toBeCloseTo(12, 9);
    expect(wallAttenuationDb('concrete', '6GHz')).toBeCloseTo(12 * 1.15, 9);

    expect(wallAttenuationDb('concrete', '2.4GHz')).toBeLessThan(
      wallAttenuationDb('concrete', '6GHz'),
    );
  });
});

describe('segmentsIntersect', () => {
  it('segmentos que se cruzan en X', () => {
    // (0,0)-(2,2) y (0,2)-(2,0) se cruzan en (1,1)
    expect(segmentsIntersect(0, 0, 2, 2, 0, 2, 2, 0)).toBe(true);
  });

  it('segmentos que no se cruzan', () => {
    expect(segmentsIntersect(0, 0, 1, 0, 0, 1, 1, 1)).toBe(false); // paralelas horizontales separadas
    expect(segmentsIntersect(0, 0, 1, 1, 3, 3, 4, 4)).toBe(false); // colineales disjuntos
  });

  it('paralelas (no colineales) nunca cruzan', () => {
    expect(segmentsIntersect(0, 0, 5, 0, 0, 2, 5, 2)).toBe(false);
  });

  it('colineales con solape cuentan como intersección', () => {
    expect(segmentsIntersect(0, 0, 2, 0, 1, 0, 3, 0)).toBe(true);
  });

  it('colineales sin solape no cruzan', () => {
    expect(segmentsIntersect(0, 0, 1, 0, 2, 0, 3, 0)).toBe(false);
  });

  it('tocar en un extremo cuenta como intersección (decisión inclusiva)', () => {
    // AB acaba en (1,1); CD empieza en (1,1)
    expect(segmentsIntersect(0, 0, 1, 1, 1, 1, 2, 0)).toBe(true);
    // extremo de un segmento apoyado sobre el interior del otro (forma T)
    expect(segmentsIntersect(0, 0, 2, 0, 1, 0, 1, 2)).toBe(true);
  });

  it('en forma de T sin tocar no cruza', () => {
    // el segmento vertical arranca por encima de la horizontal
    expect(segmentsIntersect(0, 0, 2, 0, 1, 0.5, 1, 2)).toBe(false);
  });
});

describe('wallLossAlong', () => {
  it('suma la atenuación de cada pared atravesada', () => {
    // Rayo horizontal de (0,1) a (4,1). Dos paredes verticales lo cruzan.
    const walls: Wall[] = [
      wall({ id: 'a', x1: 1, y1: 0, x2: 1, y2: 2, material: 'drywall' }), // 3 dB @5GHz
      wall({ id: 'b', x1: 2, y1: 0, x2: 2, y2: 2, material: 'brick' }), // 8 dB @5GHz
      wall({ id: 'c', x1: 10, y1: 0, x2: 10, y2: 2, material: 'metal' }), // fuera del rayo
    ];
    expect(wallLossAlong(0, 1, 4, 1, walls, '5GHz')).toBeCloseTo(3 + 8, 9);
  });

  it('sin paredes atravesadas la pérdida es 0', () => {
    const walls: Wall[] = [wall({ x1: 10, y1: 10, x2: 11, y2: 11 })];
    expect(wallLossAlong(0, 0, 1, 1, walls, '5GHz')).toBe(0);
  });

  it('escala con la banda (misma geometría, distinta banda)', () => {
    const walls: Wall[] = [
      wall({ x1: 1, y1: 0, x2: 1, y2: 2, material: 'concrete' }),
    ];
    const at24 = wallLossAlong(0, 1, 2, 1, walls, '2.4GHz');
    const at6 = wallLossAlong(0, 1, 2, 1, walls, '6GHz');
    expect(at24).toBeCloseTo(12 * 0.75, 9);
    expect(at6).toBeCloseTo(12 * 1.15, 9);
    expect(at24).toBeLessThan(at6);
  });
});

describe('rssiFromAp', () => {
  const opts = { band: '5GHz' as WifiBand, pathLossExponent: 3, minDistanceM: 1 };

  it('en línea de visión = txPower - pathLoss', () => {
    const a = ap({ x: 0, y: 0, txPowerDbm: 20 });
    const rssi = rssiFromAp(3, 4, a, [], opts); // d = 5
    expect(rssi).toBeCloseTo(20 - pathLoss(5, '5GHz', 3), 9);
  });

  it('decrece con la distancia', () => {
    const a = ap({ x: 0, y: 0 });
    const near = rssiFromAp(1, 0, a, [], opts);
    const far = rssiFromAp(20, 0, a, [], opts);
    expect(near).toBeGreaterThan(far);
  });

  it('una pared en medio resta su atenuación', () => {
    const a = ap({ x: 0, y: 1, txPowerDbm: 20 });
    const walls: Wall[] = [wall({ x1: 2, y1: 0, x2: 2, y2: 2, material: 'brick' })];
    const clear = rssiFromAp(4, 1, a, [], opts);
    const blocked = rssiFromAp(4, 1, a, walls, opts);
    expect(clear - blocked).toBeCloseTo(wallAttenuationDb('brick', '5GHz'), 9);
  });

  it('2.4 GHz atraviesa una pared mejor que 6 GHz (mismo txPower/distancia)', () => {
    const walls: Wall[] = [wall({ x1: 2, y1: 0, x2: 2, y2: 2, material: 'concrete' })];
    const a24 = ap({ x: 0, y: 1, txPowerDbm: 20, bands: ['2.4GHz'] });
    const a6 = ap({ x: 0, y: 1, txPowerDbm: 20, bands: ['6GHz'] });
    // Aislamos la atenuación de pared restando la parte de path loss/FSPL:
    // comparamos la pérdida por pared, que es lo que cambia entre bandas.
    const loss24 = wallAttenuationDb('concrete', '2.4GHz');
    const loss6 = wallAttenuationDb('concrete', '6GHz');
    expect(loss24).toBeLessThan(loss6);

    // Y a nivel de RSSI, con la misma banda base, la pared 2.4 quita menos dB.
    const r24Clear = rssiFromAp(4, 1, a24, [], { band: '2.4GHz', pathLossExponent: 3 });
    const r24Wall = rssiFromAp(4, 1, a24, walls, { band: '2.4GHz', pathLossExponent: 3 });
    const r6Clear = rssiFromAp(4, 1, a6, [], { band: '6GHz', pathLossExponent: 3 });
    const r6Wall = rssiFromAp(4, 1, a6, walls, { band: '6GHz', pathLossExponent: 3 });
    expect(r24Clear - r24Wall).toBeCloseTo(loss24, 9);
    expect(r6Clear - r6Wall).toBeCloseTo(loss6, 9);
    expect(r24Clear - r24Wall).toBeLessThan(r6Clear - r6Wall);
  });
});

describe('computePredictedHeatmap — geometría de rejilla', () => {
  it('cols/rows = ceil(dim/cellSize), mínimo 1', () => {
    const hm = computePredictedHeatmap(10, 6, [], [], { band: '5GHz', cellSizeM: 0.5 });
    expect(hm.cols).toBe(20);
    expect(hm.rows).toBe(12);
    expect(hm.cellSizeM).toBe(0.5);
    expect(hm.values).toHaveLength(20 * 12);
  });

  it('redondea hacia arriba las dimensiones no múltiplas', () => {
    const hm = computePredictedHeatmap(10.1, 5.9, [], [], { band: '5GHz', cellSizeM: 0.5 });
    expect(hm.cols).toBe(21); // ceil(20.2)
    expect(hm.rows).toBe(12); // ceil(11.8)
  });

  it('dimensiones diminutas dan al menos 1x1', () => {
    const hm = computePredictedHeatmap(0.1, 0.1, [], [], { band: '5GHz', cellSizeM: 0.5 });
    expect(hm.cols).toBe(1);
    expect(hm.rows).toBe(1);
    expect(hm.values).toHaveLength(1);
  });

  it('cellSizeM default = 0.5', () => {
    const hm = computePredictedHeatmap(2, 2, [], [], { band: '5GHz' });
    expect(hm.cellSizeM).toBe(0.5);
    expect(hm.cols).toBe(4);
    expect(hm.rows).toBe(4);
  });

  it('metadatos de banda/source/dimensiones', () => {
    const hm = computePredictedHeatmap(3, 2, [], [], { band: '6GHz' });
    expect(hm.band).toBe('6GHz');
    expect(hm.source).toBe('predicted');
    expect(hm.widthM).toBe(3);
    expect(hm.heightM).toBe(2);
  });

  it('el valor de una celda coincide con rssiFromAp evaluado en su centro (row-major)', () => {
    const opts = { band: '5GHz' as WifiBand, cellSizeM: 0.5, pathLossExponent: 3 };
    const a = ap({ x: 0, y: 0, txPowerDbm: 30, bands: ['5GHz'] });
    const hm = computePredictedHeatmap(2, 2, [a], [], opts);
    // Celda (col=2, row=1) → centro ((2+0.5)*0.5, (1+0.5)*0.5) = (1.25, 0.75)
    const col = 2;
    const row = 1;
    const cx = (col + 0.5) * 0.5;
    const cy = (row + 0.5) * 0.5;
    const expected = rssiFromAp(cx, cy, a, [], opts);
    expect(hm.values[row * hm.cols + col]).toBeCloseTo(expected as number, 9);
  });
});

describe('computePredictedHeatmap — selección de APs y suelo', () => {
  const base = { band: '5GHz' as WifiBand, cellSizeM: 1, pathLossExponent: 3 };

  it('sin APs todas las celdas son null', () => {
    const hm = computePredictedHeatmap(3, 3, [], [], base);
    expect(hm.values.every((v) => v === null)).toBe(true);
  });

  it('un AP deshabilitado no contribuye', () => {
    const a = ap({ x: 0, y: 0, enabled: false, bands: ['5GHz'], txPowerDbm: 30 });
    const hm = computePredictedHeatmap(3, 3, [a], [], base);
    expect(hm.values.every((v) => v === null)).toBe(true);
  });

  it('un AP de otra banda no contribuye', () => {
    const a = ap({ x: 0, y: 0, bands: ['2.4GHz'], txPowerDbm: 30 });
    const hm = computePredictedHeatmap(3, 3, [a], [], base);
    expect(hm.values.every((v) => v === null)).toBe(true);
  });

  it('celda null si el mejor RSSI queda por debajo del floor', () => {
    // floor muy alto (-30) → casi todo cae por debajo
    const a = ap({ x: 0, y: 0, bands: ['5GHz'], txPowerDbm: 0 });
    const hm = computePredictedHeatmap(5, 5, [a], [], { ...base, floorDbm: -30 });
    // La celda lejana debe ser null
    const lastIdx = hm.rows * hm.cols - 1;
    expect(hm.values[lastIdx]).toBeNull();
  });

  it('floor default -95: celda muy débil pero por encima sigue teniendo valor', () => {
    const a = ap({ x: 0, y: 0, bands: ['5GHz'], txPowerDbm: 20 });
    const hm = computePredictedHeatmap(3, 3, [a], [], base);
    // La celda del centro (cerca del AP) tiene señal fuerte
    expect(hm.values[0]).not.toBeNull();
    expect(hm.values[0]).toBeGreaterThan(-95);
  });

  it('la celda toma el MÁXIMO (más cercano a 0) sobre varios APs', () => {
    const opts = { band: '5GHz' as WifiBand, cellSizeM: 1, pathLossExponent: 3 };
    const far = ap({ id: 'far', x: 0, y: 0, bands: ['5GHz'], txPowerDbm: 20 });
    const near = ap({ id: 'near', x: 2.5, y: 2.5, bands: ['5GHz'], txPowerDbm: 20 });
    const hm = computePredictedHeatmap(5, 5, [far, near], [], opts);
    // Celda que contiene ~(2.5,2.5): col=row=2 con cellSize 1 → centro (2.5,2.5)
    const idx = 2 * hm.cols + 2;
    const rNear = rssiFromAp(2.5, 2.5, near, [], opts);
    const rFar = rssiFromAp(2.5, 2.5, far, [], opts);
    expect(rNear).toBeGreaterThan(rFar);
    expect(hm.values[idx]).toBeCloseTo(rNear as number, 9);
  });

  it('minDbm/maxDbm reflejan las cotas de las celdas con señal', () => {
    const a = ap({ x: 0, y: 0, bands: ['5GHz'], txPowerDbm: 30 });
    const hm = computePredictedHeatmap(4, 4, [a], [], base);
    const withValue = hm.values.filter((v): v is number => v !== null);
    expect(hm.minDbm).toBeCloseTo(Math.min(...withValue), 9);
    expect(hm.maxDbm).toBeCloseTo(Math.max(...withValue), 9);
  });

  it('sin señal en ninguna celda, las cotas colapsan al floor', () => {
    const hm = computePredictedHeatmap(3, 3, [], [], { ...base, floorDbm: -90 });
    expect(hm.minDbm).toBe(-90);
    expect(hm.maxDbm).toBe(-90);
  });
});
