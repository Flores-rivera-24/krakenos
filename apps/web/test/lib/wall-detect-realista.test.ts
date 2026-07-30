import { describe, expect, it } from 'vitest';
import { detectWalls, type GrayImage } from '@/lib/wall-detect';

/**
 * Métrica del detector de paredes contra entradas **realistas** (US-237).
 *
 * Los fixtures originales (US-195) eran líneas de 1-3 px sobre blanco perfecto, y
 * con eso el detector parecía correcto. La 3ª auditoría lo probó con lo que de
 * verdad sube un usuario —una **foto de móvil**— y midió: sombra/viñeteado
 * **5 → 311 paredes**, rotación de 2° **4 → 20**, y un muro relleno de 20 px
 * **→ 5 paredes**. Cada pared falsa **cobra atenuación** en el modelo RF, así que
 * el mapa declaraba zonas muertas inexistentes.
 *
 * ⚠️ Aquellas cifras se midieron sobre **fotos reales**; los fixtures de aquí son
 * sintéticos y reproducen los mismos fenómenos (viñeteado, sombra dura, muro
 * macizo, rotación), no los mismos números. Lo que fijan es el **orden de
 * magnitud** y el invariante de no inventar.
 *
 * Estas pruebas son la métrica que faltaba: si alguien vuelve a un umbral global o
 * rompe la fusión de bandas, los números se disparan y estos tests caen.
 */

const W = 400;
const H = 300;
const FONDO = 240;
const TINTA = 30;

function lienzo(w = W, h = H, valor = FONDO): GrayImage {
  return { data: new Uint8ClampedArray(w * h).fill(valor), width: w, height: h };
}

function pinta(img: GrayImage, x: number, y: number, v: number): void {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= img.width || yi >= img.height) return;
  img.data[yi * img.width + xi] = v;
}

/** Segmento recto con grosor, en píxeles (recorre el eje dominante). */
function linea(img: GrayImage, x1: number, y1: number, x2: number, y2: number, grosor = 3): void {
  const pasos = Math.ceil(Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1)));
  const r = Math.floor(grosor / 2);
  for (let i = 0; i <= pasos; i++) {
    const t = pasos === 0 ? 0 : i / pasos;
    const x = x1 + (x2 - x1) * t;
    const y = y1 + (y2 - y1) * t;
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) pinta(img, x + dx, y + dy, TINTA);
    }
  }
}

/** Habitación rectangular: 4 paredes. Es el plano mínimo creíble. */
function habitacion(grosor = 3): GrayImage {
  const img = lienzo();
  linea(img, 40, 30, 360, 30, grosor);
  linea(img, 40, 270, 360, 270, grosor);
  linea(img, 40, 30, 40, 270, grosor);
  linea(img, 360, 30, 360, 270, grosor);
  return img;
}

/**
 * Viñeteado radial: lo que hace CUALQUIER cámara de móvil. Las esquinas quedan
 * mucho más oscuras que el centro **sin que haya tinta**.
 */
function conVinneteado(img: GrayImage, fuerza = 0.55): GrayImage {
  const out = lienzo(img.width, img.height, 0);
  const cx = img.width / 2;
  const cy = img.height / 2;
  const rMax = Math.hypot(cx, cy);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const r = Math.hypot(x - cx, y - cy) / rMax;
      const factor = 1 - fuerza * r * r;
      out.data[y * img.width + x] = Math.round((img.data[y * img.width + x] ?? 0) * factor);
    }
  }
  return out;
}

/** Sombra diagonal dura, como la de una mano o el propio móvil al fotografiar. */
function conSombra(img: GrayImage): GrayImage {
  const out = lienzo(img.width, img.height, 0);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const enSombra = x + y > img.width * 0.9;
      const factor = enSombra ? 0.45 : 1;
      out.data[y * img.width + x] = Math.round((img.data[y * img.width + x] ?? 0) * factor);
    }
  }
  return out;
}

describe('detector de paredes con entradas realistas (US-237)', () => {
  it('plano limpio: encuentra las 4 paredes sin inventar', () => {
    const paredes = detectWalls(habitacion());
    expect(paredes.length).toBeGreaterThanOrEqual(4);
    // El listón de la regresión: un rectángulo son 4 paredes, no docenas.
    expect(paredes.length).toBeLessThanOrEqual(8);
  });

  /**
   * EL caso que rompió el gancho. Con umbral global, las esquinas oscurecidas caían
   * por debajo de `media − 30` y se convertían en tinta: 311 paredes.
   */
  it('foto con viñeteado: NO explota en paredes falsas', () => {
    const paredes = detectWalls(conVinneteado(habitacion()));
    expect(paredes.length).toBeGreaterThanOrEqual(4);
    expect(paredes.length).toBeLessThanOrEqual(12);
  });

  it('foto con sombra dura: NO explota en paredes falsas', () => {
    const paredes = detectWalls(conSombra(habitacion()));
    expect(paredes.length).toBeGreaterThanOrEqual(4);
    expect(paredes.length).toBeLessThanOrEqual(12);
  });

  /**
   * Un muro relleno (planos con muros macizos en negro) daba **una pared por cada
   * ~3 px de grosor**, y en el RF cada una sumaba su atenuación: 5 × 8 dB = 40 dB
   * para un tabique de 8 dB.
   */
  it('muro relleno de 20 px = UNA pared, no una por cada 3 px', () => {
    const img = lienzo();
    linea(img, 60, 150, 340, 150, 20);
    const paredes = detectWalls(img);
    expect(paredes.length).toBe(1);
  });

  it('muro relleno de 40 px sigue siendo UNA pared', () => {
    const img = lienzo();
    linea(img, 60, 150, 340, 150, 40);
    expect(detectWalls(img)).toHaveLength(1);
  });

  it('dos paredes paralelas SEPARADAS siguen siendo dos (no se fusiona de más)', () => {
    const img = lienzo();
    linea(img, 60, 100, 340, 100, 3);
    linea(img, 60, 200, 340, 200, 3);
    expect(detectWalls(img)).toHaveLength(2);
  });

  it('rotación de 2°: degrada sin inventar decenas de fragmentos', () => {
    const img = lienzo();
    const rad = (2 * Math.PI) / 180;
    const dx = Math.cos(rad);
    const dy = Math.sin(rad);
    linea(img, 60, 150, 60 + 280 * dx, 150 + 280 * dy, 3);
    const paredes = detectWalls(img);
    // Puede perderla (es diagonal, degradación aceptada y documentada) o verla
    // como una sola; lo que NO puede es fabricar una ristra de fragmentos.
    expect(paredes.length).toBeLessThanOrEqual(4);
  });

  /**
   * Prueba de que el fixture DISCRIMINA: sin esto, los tests de arriba podrían
   * estar pasando por casualidad.
   *
   * Se compara sobre un **degradado puro, sin una sola gota de tinta**. El umbral
   * global de antes (`media − 30`, literalmente lo que había) declara pared donde
   * no hay absolutamente nada que detectar; el local no inventa ninguna. Es la
   * diferencia cualitativa que importa, y la que rompía el mapa de cobertura:
   * cada pared inventada **cobra atenuación** y crea una zona muerta ficticia.
   *
   * _Nota honesta:_ la cifra de 311 paredes de la auditoría salía de la
   * combinación umbral global **+** la fusión vieja. Aquí solo se puede aislar el
   * umbral, porque la fusión por bandas ya está arreglada y absorbe parte del daño.
   */
  it('el umbral GLOBAL de antes inventa paredes sin tinta; el local no', () => {
    const degradado = conVinneteado(lienzo(400, 300, 250));
    let suma = 0;
    for (let i = 0; i < degradado.data.length; i++) suma += degradado.data[i] ?? 0;
    const umbralViejo = suma / degradado.data.length - 30;

    expect(detectWalls(degradado, { threshold: umbralViejo }).length).toBeGreaterThan(0);
    expect(detectWalls(degradado)).toEqual([]);
  });

  it('invariante intacto: fondo liso y ruido no inventan paredes', () => {
    expect(detectWalls(lienzo(200, 200, 255))).toEqual([]);
    // Viñeteado SIN tinta: puro degradado, ninguna pared.
    expect(detectWalls(conVinneteado(lienzo(200, 200, 250)))).toEqual([]);
  });
});
