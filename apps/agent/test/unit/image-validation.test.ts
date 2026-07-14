import { describe, expect, it } from 'vitest';
import {
  detectImageMime,
  parseImageDataUrl,
  validateBackgroundImage,
} from '../../src/coverage/image-validation.js';

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIG = [0xff, 0xd8, 0xff, 0xe0];
const WEBP = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1, 2, 3];
const GIF_SIG = [0x47, 0x49, 0x46, 0x38];

const dataUrl = (mime: string, sig: number[]) =>
  `data:${mime};base64,${Buffer.from(Uint8Array.from([...sig, 0, 1, 2, 3])).toString('base64')}`;

describe('detectImageMime', () => {
  it('reconoce PNG, JPEG y WebP por sus magic bytes', () => {
    expect(detectImageMime(Uint8Array.from(PNG_SIG))).toBe('image/png');
    expect(detectImageMime(Uint8Array.from(JPEG_SIG))).toBe('image/jpeg');
    expect(detectImageMime(Uint8Array.from(WEBP))).toBe('image/webp');
  });

  it('rechaza contenido que no es imagen permitida (GIF, vacío)', () => {
    expect(detectImageMime(Uint8Array.from(GIF_SIG))).toBeNull();
    expect(detectImageMime(new Uint8Array())).toBeNull();
  });

  it('WebP requiere el marcador WEBP en el offset 8 (no basta con RIFF)', () => {
    const riffNoWebp = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(detectImageMime(riffNoWebp)).toBeNull();
  });
});

describe('parseImageDataUrl', () => {
  it('extrae mime y bytes de un data URL base64', () => {
    const parsed = parseImageDataUrl(dataUrl('image/png', PNG_SIG));
    expect(parsed?.mime).toBe('image/png');
    expect([...parsed!.bytes.slice(0, 8)]).toEqual(PNG_SIG);
  });

  it('devuelve null si no es un data URL base64 de imagen', () => {
    expect(parseImageDataUrl('http://x/y.png')).toBeNull();
    expect(parseImageDataUrl('data:image/png,notbase64')).toBeNull();
  });
});

describe('validateBackgroundImage', () => {
  it('acepta una imagen PNG/JPEG/WebP coherente', () => {
    expect(validateBackgroundImage(dataUrl('image/png', PNG_SIG))).toEqual({ ok: true, mime: 'image/png' });
    expect(validateBackgroundImage(dataUrl('image/jpeg', JPEG_SIG)).ok).toBe(true);
    expect(validateBackgroundImage(dataUrl('image/webp', WEBP)).ok).toBe(true);
  });

  it('rechaza un MIME no permitido aunque sea data URL', () => {
    const res = validateBackgroundImage(dataUrl('image/gif', GIF_SIG));
    expect(res.ok).toBe(false);
  });

  it('rechaza el disfraz: MIME declarado ≠ contenido real', () => {
    // Dice png pero el contenido es jpeg.
    const res = validateBackgroundImage(dataUrl('image/png', JPEG_SIG));
    expect(res).toEqual({ ok: false, reason: expect.stringContaining('no coincide') });
  });

  it('rechaza contenido que no es imagen (png declarado, bytes basura)', () => {
    const res = validateBackgroundImage(dataUrl('image/png', GIF_SIG));
    expect(res.ok).toBe(false);
  });

  it('rechaza algo que no es data URL de imagen', () => {
    expect(validateBackgroundImage('data:application/pdf;base64,AAAA').ok).toBe(false);
    expect(validateBackgroundImage('nope').ok).toBe(false);
  });
});
