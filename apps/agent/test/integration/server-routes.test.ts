import type { FastifyInstance } from 'fastify';
import { afterAll, describe, expect, it } from 'vitest';
import { buildServer } from '../../src/server.js';
import { buildTestApp } from '../helpers/app.js';

/**
 * AUD-21: el cableado REAL (`buildServer`) nunca se ejercitaba en unit/integración
 * —los tests usan `buildTestApp`, que re-registra los módulos a mano y puede
 * derivar en silencio—. Este test arranca el servidor real, recolecta su tabla de
 * rutas y exige que el test-app cubra **todas** sus rutas `/api`: si alguien añade
 * un módulo a `server.ts` pero no al helper de tests, salta aquí.
 */
describe('paridad de rutas server real ↔ test-app (AUD-21)', () => {
  let real: FastifyInstance | null = null;
  let testApp: FastifyInstance | null = null;

  afterAll(async () => {
    await real?.close();
    await testApp?.close();
  });

  it('el test-app cubre todas las rutas /api del servidor real', async () => {
    real = await buildServer();
    testApp = await buildTestApp({ routes: true });

    const routesOf = (app: FastifyInstance): Set<string> => {
      const acc = new Set<string>();
      const list = (app as unknown as { collectedRoutes?: { method: string; url: string }[] })
        .collectedRoutes;
      // El server real no expone collectedRoutes; usamos printRoutes como fuente.
      if (list) {
        for (const r of list) if (r.url.startsWith('/api')) acc.add(`${r.method} ${r.url}`);
        return acc;
      }
      return acc;
    };

    // El test-app sí recolecta rutas (AUD-22). Para el server real, parseamos su
    // árbol impreso, que lista método + ruta.
    const realApiRoutes = new Set<string>();
    for (const line of real.printRoutes({ commonPrefix: false }).split('\n')) {
      const m = /^\s*(?:[│├└─\s]*)(\/\S*)\s+\(([^)]+)\)/.exec(line);
      if (!m) continue;
      const url = m[1]!;
      if (!url.startsWith('/api')) continue;
      for (const method of m[2]!.split(',').map((s) => s.trim())) {
        realApiRoutes.add(`${method} ${url}`);
      }
    }

    const testAppRoutes = routesOf(testApp);

    // US-230 (AUD3-31/32): **guard de tamaño mínimo**. Sin él este meta-test es
    // decorativo — si el parseo de `printRoutes` deja de casar (cambio de formato
    // del árbol de Fastify) o `collectedRoutes` viene vacío, `missing` sale `[]` y
    // el test pasa **sin haber comprobado nada**. «No encontré nada» no puede
    // confundirse con «está todo bien». El suelo es holgado a propósito: solo debe
    // saltar ante un fallo de recolección, no ante un módulo de menos.
    expect(realApiRoutes.size).toBeGreaterThan(100);
    expect(testAppRoutes.size).toBeGreaterThan(100);

    // Toda ruta /api del servidor real debe existir en el test-app.
    const missing = [...realApiRoutes].filter((r) => !testAppRoutes.has(r));
    expect({ missing }).toEqual({ missing: [] });
  });

  it('arrancar sin usuarios libera el candado de configuración obsoleto', async () => {
    // El efecto que REPARA la instalación bloqueada vive en el arranque, no en una
    // ruta: sin este test, borrar esa llamada de `buildServer` no rompería nada y
    // una instalación sin usuarios volvería a quedarse sin wizard y sin login.
    const seeder = await buildTestApp({});
    try {
      await seeder.prisma.user.deleteMany();
      await seeder.prisma.setting.upsert({
        where: { key: 'setup.claimed' },
        create: { key: 'setup.claimed', value: 'true' },
        update: { value: 'true' },
      });
    } finally {
      await seeder.close();
    }

    const arrancado = await buildServer();
    try {
      const candado = await arrancado.prisma.setting.findUnique({
        where: { key: 'setup.claimed' },
      });
      expect(candado).toBeNull();
    } finally {
      await arrancado.close();
    }
  });
});
