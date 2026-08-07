import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp } from '../helpers/app.js';

/**
 * Barrido de autenticación sobre **todas** las lecturas de `/api`.
 *
 * Qué agujero tapa. `authorization.test.ts` barre exhaustivamente las rutas de
 * **escritura** (AUD-22) y clasifica las lecturas de tres módulos concretos
 * —cámaras (AUD3-02), DNS y tráfico (US-250)—, que son los que se colaron en su
 * día. Pero **ninguna prueba vigila el resto de los GET**: una ruta de lectura
 * nueva registrada sin `preHandler` queda **abierta a internet** y toda la suite
 * sigue en verde. El agujero no es hipotético: los dos incidentes que motivaron
 * aquellas historias fueron exactamente eso, lecturas que el cliente escondía y
 * el servidor servía a cualquiera.
 *
 * Por qué en negro (petición real sin token) y no inspeccionando `preHandler`:
 * los módulos protegen de dos formas distintas —unos con `preHandler` por ruta y
 * otros con un `app.addHook('preHandler', app.authenticate)` para todo el
 * plugin (p. ej. `inventory.routes.ts`)—, y el hook encapsulado **no** aparece
 * en las opciones de la ruta. Una comprobación blanca daría falsos positivos en
 * unos módulos y, peor, pasaría por alto los otros. La petición sin token mide
 * lo único que importa: **qué contesta el servidor a quien no se ha
 * identificado**.
 */
describe('barrido de autenticación de lecturas (/api GET)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp({ routes: true });
  });

  afterAll(async () => {
    await app.close();
  });

  /**
   * Lecturas **públicas por diseño**, cada una con su motivo. Añadir algo aquí es
   * una decisión de producto: se sirve a cualquiera que alcance el puerto.
   */
  const PUBLIC_READS = new Set<string>([
    // El wizard tiene que saber si la instalación ya está reclamada ANTES de que
    // exista ningún usuario: sin esto no hay forma de arrancar.
    'GET /api/setup/status',
    // Nombre del hogar para la pantalla de login. La versión solo se incluye si
    // se habilita su divulgación (US-83): por defecto NO, para no regalar
    // fingerprinting/CVE-matching a un atacante sin autenticar.
    'GET /api/system/info',
    // IP+hora del último login para la pantalla de login (US-49). **Off por
    // defecto** (US-83): con `PUBLIC_LAST_SESSION=false` devuelve `null`. Nunca
    // incluye email ni userId.
    'GET /api/auth/last-session',
  ]);

  /**
   * Playlist y segmentos HLS (US-185): no llevan sesión **a propósito** — los
   * autentica el token de stream de `?st=`, que solo emite
   * `POST /api/cameras/:id/stream`, que sí exige la capacidad `home.cameras`.
   * Sin token de stream responden 401, así que el barrido las trata como
   * cualquier otra ruta protegida; se documentan aquí para que quede dicho.
   */

  it('ninguna lectura /api sirve datos sin token', async () => {
    const collected = (app as unknown as { collectedRoutes: { method: string; url: string }[] })
      .collectedRoutes;

    // Guard de tamaño: si `onRoute` dejara de poblar la tabla (upgrade de
    // Fastify), la lista saldría vacía y este barrido pasaría **sin haber
    // comprobado nada**. «No encontré rutas» no puede leerse como «todo bien».
    const gets = collected.filter(
      (r) => r.method.toUpperCase() === 'GET' && r.url.startsWith('/api'),
    );
    expect(gets.length).toBeGreaterThan(60);

    const seen = new Set<string>();
    const abiertas: string[] = [];

    for (const r of gets) {
      const key = `GET ${r.url}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (PUBLIC_READS.has(key)) continue;

      // Un valor cualquiera para los params: da igual que no exista el recurso —
      // lo que se mide es si el servidor **contesta** sin identificarse. Un 404
      // ya implica que pasó el control de acceso, por eso se exige 401/403.
      const res = await app.inject({ method: 'GET', url: r.url.replace(/:[^/]+/g, 'x') });
      if (res.statusCode < 400) {
        abiertas.push(`${key} → ${res.statusCode}`);
      }
    }

    expect(abiertas).toEqual([]);
  });

  /**
   * El allowlist tiene que envejecer mal a propósito: si alguien borra una ruta
   * pública, su entrada aquí se queda como permiso huérfano y, el día que ese
   * path se reutilice para otra cosa, nacería abierta sin que nadie lo decidiera.
   */
  it('el allowlist de rutas públicas no tiene entradas muertas', () => {
    const collected = (app as unknown as { collectedRoutes: { method: string; url: string }[] })
      .collectedRoutes;
    const existentes = new Set(
      collected
        .filter((r) => r.method.toUpperCase() === 'GET')
        .map((r) => `GET ${r.url}`),
    );
    const huerfanas = [...PUBLIC_READS].filter((k) => !existentes.has(k));
    expect(huerfanas).toEqual([]);
  });
});
