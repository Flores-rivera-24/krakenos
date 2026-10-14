import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authHeader, buildTestApp, resetDb, seedUser, signAccess } from '../helpers/app.js';

/**
 * Aislamiento por dueño, de forma genérica.
 *
 * Qué agujero tapa. Que un recurso sea «de cada usuario» era una convención por
 * consulta (`where: { userId: req.user.sub }`): cada ruta nueva tenía que acordarse
 * de ella, y olvidarla no rompe ningún test ni da error — solo deja ver o tocar lo de
 * otro. Esta tabla recorre los recursos por usuario que expone la API con la misma
 * partitura: A crea; B (otro usuario no admin y también otro admin) no lo ve en su
 * listado, y sus intentos de tocarlo por id no tienen efecto (A lo sigue teniendo).
 *
 * Un recurso por usuario NUEVO se añade a `RECURSOS`; el guard de tamaño impide que
 * la tabla se vacíe sin que nadie lo note.
 */

interface Actor {
  id: string;
  token: string;
}

interface Intento {
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  payload?: unknown;
  /** Estados admitidos: lo que importa es el efecto, pero un 200/204 sin más sería sospechoso. */
  ok: number[];
}

interface Recurso {
  nombre: string;
  /** Si el admin ajeno también debe quedar fuera (false = el admin puede por diseño). */
  adminAjenoSinAcceso: boolean;
  /** A crea el recurso y devuelve su id. */
  crear(app: FastifyInstance, a: Actor): Promise<string>;
  /** Ids del recurso que ve `actor` en su listado. */
  listar(app: FastifyInstance, actor: Actor): Promise<string[]>;
  /** Intentos de B de modificar/borrar lo de A. */
  intentos(id: string): Intento[];
}

const idsDe = (res: { json: () => unknown }) => (res.json() as { id: string }[]).map((x) => x.id);

const RECURSOS: Recurso[] = [
  {
    nombre: 'favoritos',
    adminAjenoSinAcceso: true,
    async crear(app, a) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/favorites',
        headers: authHeader(a.token),
        payload: { kind: 'iot', ref: 'light-salon' },
      });
      expect(res.statusCode).toBe(201);
      return (res.json() as { id: string }).id;
    },
    async listar(app, actor) {
      const res = await app.inject({
        method: 'GET',
        url: '/api/favorites',
        headers: authHeader(actor.token),
      });
      return idsDe(res);
    },
    intentos: (id) => [
      { method: 'DELETE', url: `/api/favorites/${id}`, ok: [404] },
      // Reordenar con el id ajeno no puede mover ni tocar el favorito de A.
      { method: 'PUT', url: '/api/favorites/order', payload: { ids: [id] }, ok: [200, 400, 404] },
    ],
  },
  {
    nombre: 'tokens de API',
    adminAjenoSinAcceso: true,
    async crear(app, a) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/tokens',
        headers: authHeader(a.token),
        payload: { name: 'de A', scopes: ['home.view'] },
      });
      expect(res.statusCode).toBe(201);
      return (res.json() as { id: string }).id;
    },
    async listar(app, actor) {
      const res = await app.inject({
        method: 'GET',
        url: '/api/tokens',
        headers: authHeader(actor.token),
      });
      return idsDe(res);
    },
    intentos: (id) => [{ method: 'DELETE', url: `/api/tokens/${id}`, ok: [404] }],
  },
  {
    nombre: 'suscripciones push',
    adminAjenoSinAcceso: true,
    async crear(app, a) {
      const endpoint = 'https://push.example/de-a';
      const res = await app.inject({
        method: 'POST',
        url: '/api/push/subscribe',
        headers: authHeader(a.token),
        payload: { endpoint, keys: { p256dh: 'pkey', auth: 'akey' } },
      });
      expect(res.statusCode).toBe(204);
      return endpoint;
    },
    // No hay ruta de listado: se lee la tabla, que es lo único que prueba el efecto.
    async listar(app, actor) {
      const rows = await app.prisma.pushSubscription.findMany({ where: { userId: actor.id } });
      return rows.map((r) => r.endpoint);
    },
    intentos: (endpoint) => [
      // Borrar por endpoint ajeno: no hace nada (acotado por userId), sin error.
      { method: 'DELETE', url: '/api/push/subscribe', payload: { endpoint }, ok: [204] },
      // Re-suscribir un endpoint ajeno no lo reasigna (409).
      {
        method: 'POST',
        url: '/api/push/subscribe',
        payload: { endpoint, keys: { p256dh: 'otra', auth: 'otra' } },
        ok: [409],
      },
    ],
  },
  {
    nombre: 'passkeys (credenciales WebAuthn)',
    adminAjenoSinAcceso: true,
    async crear(app, a) {
      const row = await app.prisma.webAuthnCredential.create({
        data: {
          userId: a.id,
          credentialId: 'cred-de-a',
          publicKey: Buffer.from([1, 2, 3]),
          counter: 0,
          deviceType: 'singleDevice',
          backedUp: false,
          name: 'iPhone de A',
        },
      });
      return row.id;
    },
    async listar(app, actor) {
      const res = await app.inject({
        method: 'GET',
        url: '/api/webauthn/credentials',
        headers: authHeader(actor.token),
      });
      return idsDe(res);
    },
    intentos: (id) => [
      {
        method: 'PATCH',
        url: `/api/webauthn/credentials/${id}`,
        payload: { name: 'robada' },
        ok: [404],
      },
      { method: 'DELETE', url: `/api/webauthn/credentials/${id}`, ok: [404] },
    ],
  },
  {
    nombre: 'códigos de recuperación',
    adminAjenoSinAcceso: true,
    // El lote no tiene id propio: se identifica por su dueño.
    async crear(app, a) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/webauthn/backup-codes',
        headers: authHeader(a.token),
      });
      expect(res.statusCode).toBe(200);
      return `lote:${a.id}`;
    },
    async listar(app, actor) {
      const res = await app.inject({
        method: 'GET',
        url: '/api/webauthn/backup-codes',
        headers: authHeader(actor.token),
      });
      const { remaining } = res.json() as { remaining: number };
      return remaining > 0 ? [`lote:${actor.id}`] : [];
    },
    // Regenerar «los códigos» siempre actúa sobre los de quien llama, nunca sobre los de A.
    intentos: () => [{ method: 'POST', url: '/api/webauthn/backup-codes', ok: [200] }],
  },
  {
    nombre: 'sesiones',
    // Un admin puede revocar la sesión de otro por diseño (`revokeSession(..., isAdmin)`):
    // el listado propio sí queda aislado, el borrado ajeno no se prueba para admin.
    adminAjenoSinAcceso: false,
    async crear(app, a) {
      const user = await app.prisma.user.findUniqueOrThrow({ where: { id: a.id } });
      const login = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: user.email, password: 'password123' },
      });
      expect(login.statusCode).toBe(200);
      const list = await app.inject({
        method: 'GET',
        url: '/api/auth/sessions',
        headers: authHeader(a.token),
      });
      return idsDe(list)[0]!;
    },
    async listar(app, actor) {
      const res = await app.inject({
        method: 'GET',
        url: '/api/auth/sessions',
        headers: authHeader(actor.token),
      });
      return idsDe(res);
    },
    intentos: (id) => [{ method: 'DELETE', url: `/api/auth/sessions/${id}`, ok: [404] }],
  },
];

describe('aislamiento por dueño de los recursos por usuario', () => {
  let app: FastifyInstance;
  let a: Actor;
  let bViewer: Actor;
  let bAdmin: Actor;

  beforeAll(async () => {
    app = await buildTestApp({ routes: true });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(app);
    const seed = async (email: string, role: 'viewer' | 'admin'): Promise<Actor> => {
      const u = await seedUser(app, { email, role });
      return { id: u.id, token: signAccess(app, u) };
    };
    a = await seed('a@krakenos.test', 'viewer');
    bViewer = await seed('b-viewer@krakenos.test', 'viewer');
    bAdmin = await seed('b-admin@krakenos.test', 'admin');
  });

  it('la tabla cubre al menos 5 recursos (guard de tamaño)', () => {
    expect(RECURSOS.length).toBeGreaterThanOrEqual(5);
    expect(new Set(RECURSOS.map((r) => r.nombre)).size).toBe(RECURSOS.length);
  });

  for (const recurso of RECURSOS) {
    describe(recurso.nombre, () => {
      const otros = (): { etiqueta: string; actor: Actor; intentar: boolean }[] => [
        { etiqueta: 'otro usuario no admin', actor: bViewer, intentar: true },
        {
          etiqueta: 'otro admin',
          actor: bAdmin,
          intentar: recurso.adminAjenoSinAcceso,
        },
      ];

      it('A lo crea y lo ve en su listado (control positivo)', async () => {
        const id = await recurso.crear(app, a);
        expect(await recurso.listar(app, a)).toContain(id);
      });

      it('el listado de otro usuario no incluye lo de A', async () => {
        const id = await recurso.crear(app, a);
        for (const o of otros()) {
          expect(await recurso.listar(app, o.actor), o.etiqueta).not.toContain(id);
        }
      });

      it('modificar o borrar lo de A por id no tiene efecto', async () => {
        const id = await recurso.crear(app, a);
        for (const o of otros()) {
          if (!o.intentar) continue;
          for (const intento of recurso.intentos(id)) {
            const res = await app.inject({
              method: intento.method,
              url: intento.url,
              headers: authHeader(o.actor.token),
              ...(intento.payload !== undefined ? { payload: intento.payload as object } : {}),
            });
            expect(
              intento.ok,
              `${o.etiqueta}: ${intento.method} ${intento.url} → ${res.statusCode}`,
            ).toContain(res.statusCode);
          }
          // A lo sigue teniendo.
          expect(await recurso.listar(app, a), o.etiqueta).toContain(id);
        }
      });
    });
  }
});
