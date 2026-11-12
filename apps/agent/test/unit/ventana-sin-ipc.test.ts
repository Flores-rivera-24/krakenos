import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../../../..');
const TAURI = resolve(ROOT, 'apps/window/src-tauri');
const leer = (ruta: string) => readFileSync(ruta, 'utf8');

/**
 * La ventana de Windows carga la web del agente (contenido remoto): ese contenido no
 * debe poder llamar a Tauri. Sin `withGlobalTauri`, sin capability `remote` y con
 * permisos solo para la ventana `main` y lo que usa el Rust.
 */
describe('ventana de Windows: la web del agente no tiene IPC de Tauri', () => {
  const capabilities = existsSync(resolve(TAURI, 'capabilities'))
    ? readdirSync(resolve(TAURI, 'capabilities')).filter((f) => f.endsWith('.json'))
    : [];

  it('hay capabilities que leer (guard de tamaño)', () => {
    expect(capabilities.length).toBeGreaterThan(0);
  });

  it('withGlobalTauri es false', () => {
    const conf = JSON.parse(leer(resolve(TAURI, 'tauri.conf.json')));
    expect(conf.app.withGlobalTauri).toBe(false);
  });

  it('ninguna capability tiene remote y solo apuntan a la ventana main', () => {
    for (const f of capabilities) {
      const cap = JSON.parse(leer(resolve(TAURI, 'capabilities', f)));
      expect(cap.remote, f).toBeUndefined();
      expect(cap.windows, f).toEqual(['main']);
    }
  });

  it('las capabilities no dan permisos a la web (solo core:default)', () => {
    for (const f of capabilities) {
      const cap = JSON.parse(leer(resolve(TAURI, 'capabilities', f)));
      expect(cap.permissions, f).toEqual([]);
    }
  });

  it('la página local no importa @tauri-apps', () => {
    expect(leer(resolve(ROOT, 'apps/window/pagina/index.html'))).not.toContain('@tauri-apps');
  });

  it('la página local lleva la CSP exacta y no carga scripts ajenos', () => {
    const html = leer(resolve(ROOT, 'apps/window/pagina/index.html'));
    expect(html).toContain(
      `content="default-src 'none'; style-src 'unsafe-inline'; script-src 'self'"`,
    );
  });

  it('.gitignore ancla /apps/window/src-tauri/target/', () => {
    expect(leer(resolve(ROOT, '.gitignore')).split('\n')).toContain(
      '/apps/window/src-tauri/target/',
    );
  });
});
