import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Contrato estático del manifiesto: lo que hace que el navegador ofrezca instalar
 * y que la app instalada tenga identidad estable. El comportamiento real
 * (que resuelva, que los iconos respondan) lo prueba la e2e `pwa.spec.ts`.
 */
const RAIZ = join(process.cwd(), 'public');
const MANIFIESTO = JSON.parse(readFileSync(join(RAIZ, 'manifest.json'), 'utf8')) as {
  id?: string;
  start_url?: string;
  scope?: string;
  display?: string;
  display_override?: unknown;
  launch_handler?: { client_mode?: string };
  icons?: { src: string; sizes: string; purpose?: string }[];
};

describe('manifest.json', () => {
  it('tiene identidad estable y ámbito de la raíz', () => {
    expect(MANIFIESTO.id).toBe('/');
    expect(MANIFIESTO.start_url).toBe('/');
    expect(MANIFIESTO.scope).toBe('/');
  });

  it('se abre en ventana propia y enfoca la existente en vez de abrir otra', () => {
    expect(MANIFIESTO.display).toBe('standalone');
    expect(MANIFIESTO.launch_handler?.client_mode).toBe('focus-existing');
  });

  it('no cambia la barra de título (window-controls-overlay queda fuera de alcance)', () => {
    expect(MANIFIESTO.display_override).toBeUndefined();
  });

  it('declara iconos 192, 512 y maskable, y los ficheros existen', () => {
    const iconos = MANIFIESTO.icons ?? [];
    expect(iconos.some((i) => i.sizes === '192x192' && !i.purpose)).toBe(true);
    expect(iconos.some((i) => i.sizes === '512x512' && !i.purpose)).toBe(true);
    expect(iconos.some((i) => i.sizes === '512x512' && i.purpose === 'maskable')).toBe(true);
    for (const i of iconos) expect(existsSync(join(RAIZ, i.src)), i.src).toBe(true);
  });
});
