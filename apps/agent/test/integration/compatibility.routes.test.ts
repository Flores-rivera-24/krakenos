import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildCompatibilityCatalog } from '../../src/modules/compatibility/compatibility.catalog.js';
import { authHeader, buildTestApp, resetDb, seedUser, signAccess } from '../helpers/app.js';

/**
 * Contrato de `/api/compatibility` (US-258).
 *
 * **Por qué existe:** el schema de respuesta lleva `additionalProperties: false`, que
 * en Fastify no valida — **poda**. `support` se añadió a `CompatibilityEntry` (US-238)
 * y no al schema, así que el sello «community · necesita la app del fabricante» salía
 * del catálogo y **no llegaba al navegador**. No lo cazó nadie: el test de la web
 * alimenta su propio fixture (que sí lo trae) y `api.get<T>()` es un **cast**, no una
 * comprobación, así que los dos lados estaban verdes y la feature invisible.
 *
 * Lo que se comprueba aquí es lo único que no puede mentir: las claves que **de
 * verdad** salen por la ruta, comparadas con las que produce el catálogo. Derivado
 * del código, no una lista a mano — un campo nuevo que se olvide en el schema pone
 * esto en rojo nombrándolo.
 */
describe('GET /api/compatibility — contrato', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp({ routes: true });
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetDb(app);
  });

  async function leerCatalogo() {
    const viewer = await seedUser(app, { email: 'v@krakenos.test', role: 'viewer' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/compatibility',
      headers: authHeader(signAccess(app, viewer)),
    });
    expect(res.statusCode).toBe(200);
    return res.json() as Record<string, unknown>[];
  }

  it('no poda ningún campo del catálogo: lo que sale es lo que se construyó', async () => {
    const servido = await leerCatalogo();
    const construido = buildCompatibilityCatalog();
    expect(servido).toHaveLength(construido.length);

    // Se compara **por entrada**, no solo la primera: `appDependency` es `null` en
    // casi todas y un objeto en las de Tuya/Govee/Meross/Kasa, así que mirar solo
    // una podría dar por bueno justo el campo que más importa.
    for (const esperada of construido) {
      const real = servido.find((e) => e.id === esperada.id);
      expect(real, `falta la entrada ${esperada.id}`).toBeTruthy();
      expect(Object.keys(real!).sort(), `${esperada.id} pierde campos por el camino`).toEqual(
        Object.keys(esperada).sort(),
      );
    }
  });

  it('el sello de mantenimiento llega al cliente (era lo que se podaba)', async () => {
    const servido = await leerCatalogo();
    expect(servido.find((e) => e.id === 'iot:tuya')?.support).toBe('community');
    expect(servido.find((e) => e.id === 'iot:hue')?.support).toBe('core');
  });

  it('la dependencia de la app del fabricante llega entera, incluido el caso Kasa/Tapo', async () => {
    const servido = await leerCatalogo();
    // El caso que no tenía marca: `core` (se mantiene) y aun así necesita la cuenta,
    // solo para parte del parque. Si `devices` se perdiera, el aviso diría «necesita
    // la app» de unos enchufes Kasa que no la necesitan.
    expect(servido.find((e) => e.id === 'iot:kasa')?.appDependency).toEqual({
      reason: 'account',
      scope: 'some',
      devices: 'Tapo',
    });
    expect(servido.find((e) => e.id === 'iot:hue')?.appDependency).toBeNull();
  });

  it('sin verificaciones con hardware, la fecha es null y no se inventa', async () => {
    const servido = await leerCatalogo();
    expect(servido.every((e) => e.verifiedAt === null)).toBe(true);
  });
});
