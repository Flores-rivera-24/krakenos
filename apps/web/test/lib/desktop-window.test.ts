import { describe, expect, it } from 'vitest';
import { isDesktopWindow } from '@/lib/desktop-window';

const EDGE =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0';

describe('isDesktopWindow', () => {
  it('reconoce el sufijo que la ventana de escritorio añade al user agent', () => {
    expect(isDesktopWindow(`${EDGE} KrakenOSWindow/0.1.0`)).toBe(true);
  });

  it('un navegador normal, Edge incluido, no es la ventana', () => {
    expect(isDesktopWindow(EDGE)).toBe(false);
    expect(isDesktopWindow('')).toBe(false);
  });
});
