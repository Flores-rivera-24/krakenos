import { describe, expect, it } from 'vitest';
import {
  computeCalibration,
  extractPdfJpeg,
  selectLargestMedia,
} from '@/lib/coverage-import';

describe('computeCalibration', () => {
  it('deriva ancho/alto reales de la línea de referencia', () => {
    // 100 px = 5 m → 0.05 m/px. Imagen 2000×1000 px → 100×50 m.
    expect(computeCalibration(100, 5, 2000, 1000)).toEqual({ widthM: 100, heightM: 50 });
  });

  it('es invariante a la escala de visualización (ref e imagen escalan juntas)', () => {
    const a = computeCalibration(100, 5, 2000, 1000);
    const b = computeCalibration(50, 5, 1000, 500); // todo a la mitad
    expect(b).toEqual(a);
  });

  it('redondea a centímetros', () => {
    const c = computeCalibration(3, 1, 10, 10); // 3.333.. m
    expect(c.widthM).toBe(3.33);
  });

  it('lanza con valores no positivos', () => {
    expect(() => computeCalibration(0, 5, 100, 100)).toThrow();
    expect(() => computeCalibration(100, 0, 100, 100)).toThrow();
  });
});

describe('selectLargestMedia', () => {
  it('elige la imagen más grande de word/media', () => {
    const entries = {
      'word/document.xml': new Uint8Array(9999),
      'word/media/image1.png': new Uint8Array(100),
      'word/media/image2.jpeg': new Uint8Array(500),
      'word/media/notes.xml': new Uint8Array(9999), // no es imagen
    };
    expect(selectLargestMedia(entries)).toHaveLength(500);
  });

  it('devuelve null si no hay imágenes en word/media', () => {
    expect(selectLargestMedia({ 'word/document.xml': new Uint8Array(10) })).toBeNull();
  });
});

describe('extractPdfJpeg', () => {
  const enc = (s: string) => Array.from(s).map((c) => c.charCodeAt(0));
  const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02, 0x03, 0x04];

  it('extrae el flujo JPEG de una imagen DCTDecode', () => {
    const bytes = Uint8Array.from([
      ...enc('%PDF-1.4 /Subtype /Image /Filter /DCTDecode /Length 8 >>\nstream\n'),
      ...JPEG,
      ...enc('\nendstream\nendobj'),
    ]);
    const out = extractPdfJpeg(bytes);
    expect(out).not.toBeNull();
    expect([...out!]).toEqual(JPEG);
  });

  it('devuelve null si no hay imagen DCTDecode', () => {
    expect(extractPdfJpeg(Uint8Array.from(enc('%PDF-1.4 sin imagenes endobj')))).toBeNull();
  });

  it('devuelve null si el flujo no empieza por la firma JPEG', () => {
    const bytes = Uint8Array.from([
      ...enc('/Filter /DCTDecode >>\nstream\n'),
      0x00, 0x01, 0x02, 0x03,
      ...enc('\nendstream'),
    ]);
    expect(extractPdfJpeg(bytes)).toBeNull();
  });
});
