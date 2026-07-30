import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * US-234 (AUD3-24) — contrato del service worker.
 *
 * `public/sw.js` no se puede ejecutar en jsdom (necesita `ServiceWorkerGlobalScope`,
 * `caches`, `FetchEvent`…), así que **no** se testea su comportamiento aquí; eso
 * exige un navegador real y va con la e2e de US-261. Lo que sí se puede —y lo que
 * habría evitado que este fichero pasara meses siendo 17 líneas sin handler
 * `fetch`— es fijar por escrito las propiedades que no pueden desaparecer.
 *
 * Cada aserción corresponde a un fallo concreto que ya ocurrió o que rompería la
 * app de forma silenciosa.
 */

const SW = readFileSync(join(process.cwd(), 'public/sw.js'), 'utf8');

describe('contrato del service worker (US-234)', () => {
  it('el fichero se leyó (guard: un sw.js movido no debe hacer pasar el test)', () => {
    expect(SW.length).toBeGreaterThan(500);
  });

  it('tiene handler `fetch`: sin él no hay PWA, solo un icono', () => {
    expect(SW).toMatch(/addEventListener\(\s*['"]fetch['"]/);
  });

  it('sigue atendiendo las notificaciones push (US-45, no se rompió al añadir la caché)', () => {
    expect(SW).toMatch(/addEventListener\(\s*['"]push['"]/);
    expect(SW).toMatch(/addEventListener\(\s*['"]notificationclick['"]/);
  });

  it('usa skipWaiting + clients.claim: sin ellos, actualizar deja pantalla blanca', () => {
    // 18 chunks hasheados + un shell viejo que los referencia = página en blanco
    // hasta que el usuario cierra TODAS las pestañas. Es el fallo clásico de PWA.
    expect(SW).toContain('skipWaiting');
    expect(SW).toContain('clients.claim');
  });

  it('borra las cachés de versiones anteriores al activarse', () => {
    expect(SW).toMatch(/caches\s*\n?\s*\.keys\(\)/);
    expect(SW).toContain('caches.delete');
  });

  it('NUNCA cachea respuestas autenticadas (/api, /health, socket.io)', () => {
    // El invariante de privacidad del SW: son datos de un panel con roles sobre un
    // dispositivo posiblemente compartido. Una copia en disco sobreviviría al
    // logout y podría servirse a la siguiente persona.
    for (const ruta of ['/api/', '/health', '/socket.io/']) {
      expect(SW, `${ruta} debe estar en la lista de solo-red`).toContain(ruta);
    }
    expect(SW).toMatch(/esSoloRed[\s\S]{0,400}return;/);
  });

  it('tiene una pantalla propia de sin conexión, no el error del navegador', () => {
    expect(SW).toContain('No llego a tu casa');
    // Debe poder volver a intentarlo desde una ventana sin barra de direcciones.
    expect(SW).toMatch(/Reintentar/);
  });

  it('la navegación va a red primero (shell fresco) con caída a caché', () => {
    expect(SW).toMatch(/req\.mode === 'navigate'/);
  });
});
