import type { Favorite } from '@krakenos/types';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authHeader, buildTestApp, resetDb, seedUser, signAccess } from '../helpers/app.js';
import { MAX_FAVORITES_PER_USER } from '../../src/modules/favorites/favorites.service.js';

/** Favoritos por usuario (US-170): autoservicio, aislados por usuario. */
describe('favoritos (US-170)', () => {
  let app: FastifyInstance;
  let token: string;
  let otherToken: string;

  beforeAll(async () => {
    app = await buildTestApp({ routes: true });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(app);
    token = signAccess(app, await seedUser(app, { role: 'viewer' }));
    otherToken = signAccess(app, await seedUser(app, { email: 'other@krakenos.test', role: 'viewer' }));
  });

  async function add(payload: { kind: string; ref: string }, t = token): Promise<Favorite> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/favorites',
      headers: authHeader(t),
      payload,
    });
    expect(res.statusCode).toBe(201);
    return res.json() as Favorite;
  }

  it('cualquier autenticado fija, lista y quita sus favoritos', async () => {
    const fav = await add({ kind: 'iot', ref: 'light-salon' });
    expect(fav.order).toBe(0);

    const list = await app.inject({ method: 'GET', url: '/api/favorites', headers: authHeader(token) });
    expect((list.json() as Favorite[])).toHaveLength(1);

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/favorites/${fav.id}`,
      headers: authHeader(token),
    });
    expect(del.statusCode).toBe(204);
    const after = await app.inject({ method: 'GET', url: '/api/favorites', headers: authHeader(token) });
    expect((after.json() as Favorite[])).toHaveLength(0);
  });

  it('fijar dos veces el mismo objetivo es idempotente (no duplica)', async () => {
    const first = await add({ kind: 'device', ref: 'dev-1' });
    const second = await add({ kind: 'device', ref: 'dev-1' });
    expect(second.id).toBe(first.id);
    const list = await app.inject({ method: 'GET', url: '/api/favorites', headers: authHeader(token) });
    expect((list.json() as Favorite[])).toHaveLength(1);
  });

  it('reordena los favoritos del usuario', async () => {
    const a = await add({ kind: 'iot', ref: 'a' });
    const b = await add({ kind: 'iot', ref: 'b' });
    const c = await add({ kind: 'iot', ref: 'c' });

    const res = await app.inject({
      method: 'PUT',
      url: '/api/favorites/order',
      headers: authHeader(token),
      payload: { ids: [c.id, a.id, b.id] },
    });
    expect(res.statusCode).toBe(200);
    const ordered = res.json() as Favorite[];
    expect(ordered.map((f) => f.ref)).toEqual(['c', 'a', 'b']);
  });

  it('los favoritos están aislados por usuario', async () => {
    await add({ kind: 'iot', ref: 'mine' }, token);
    const otherList = await app.inject({
      method: 'GET',
      url: '/api/favorites',
      headers: authHeader(otherToken),
    });
    expect((otherList.json() as Favorite[])).toHaveLength(0);

    // Un usuario no puede borrar el favorito de otro (404, no es suyo).
    const mine = (await app.inject({ method: 'GET', url: '/api/favorites', headers: authHeader(token) }).then((r) => r.json())) as Favorite[];
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/favorites/${mine[0]?.id}`,
      headers: authHeader(otherToken),
    });
    expect(del.statusCode).toBe(404);
  });

  it('sin token → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/favorites' });
    expect(res.statusCode).toBe(401);
  });

  it('cota por usuario (AUD-19): al superar el máximo devuelve 413', async () => {
    const user = await seedUser(app, { email: 'cap@krakenos.test', role: 'viewer' });
    await app.prisma.favorite.createMany({
      data: Array.from({ length: MAX_FAVORITES_PER_USER }, (_, i) => ({
        userId: user.id,
        kind: 'iot',
        ref: `light-${i}`,
        order: i,
      })),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/favorites',
      headers: authHeader(signAccess(app, user)),
      payload: { kind: 'iot', ref: 'uno-de-mas' },
    });
    expect(res.statusCode).toBe(413);
    expect(res.json().code).toBe('FAVORITE_LIMIT');
  });
});
