import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerErrorHandler } from '../../src/plugins/error-handler.js';
import Fastify from 'fastify';

/** Los 5xx no filtran el mensaje interno; los 4xx conservan su contrato. */
describe('manejador de errores global', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    registerErrorHandler(app);
    app.get('/boom', async () => {
      throw new Error('detalle secreto de prisma: SELECT * FROM User');
    });
    app.get('/boom503', async () => {
      throw Object.assign(new Error('El router no responde.'), {
        statusCode: 503,
        code: 'UPSTREAM_DOWN',
      });
    });
    app.get('/fst500', async () => {
      throw Object.assign(new Error('detalle interno de fastify'), {
        statusCode: 500,
        code: 'FST_ERR_X',
      });
    });
    app.get('/prisma', async () => {
      throw Object.assign(new Error('Unique constraint failed on User.email'), { code: 'P2002' });
    });
    app.get('/no-encontrado', async (_req, reply) => {
      const err = Object.assign(new Error('No existe ese recurso'), {
        statusCode: 404,
        code: 'X_404',
      });
      return reply.send(err);
    });
    app.post(
      '/valida',
      {
        schema: {
          body: { type: 'object', required: ['a'], properties: { a: { type: 'string' } } },
        },
      },
      async () => 'ok',
    );
    await app.ready();
  });
  afterAll(async () => app.close());

  it('un error no controlado devuelve 500 genérico sin el mensaje interno', async () => {
    const res = await app.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('detalle secreto');
    expect(res.json()).toEqual({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      error: 'Internal Server Error',
      message: 'Error interno del servidor.',
    });
  });

  it('un 5xx deliberado con code propio conserva estado, code y su copy', async () => {
    // La web en español pinta el mensaje del servidor: el copy de un DriverUnavailableError
    // es nuestro y explica qué pasa; sustituirlo por un genérico sería quitarle la honestidad.
    const res = await app.inject({ method: 'GET', url: '/boom503' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ code: 'UPSTREAM_DOWN', message: 'El router no responde.' });
  });

  it('un 5xx interno de Fastify (FST_*) no filtra su mensaje ni su code', async () => {
    const res = await app.inject({ method: 'GET', url: '/fst500' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'Error interno del servidor.',
    });
    expect(res.body).not.toContain('detalle interno');
  });

  it('el code interno de un error sin statusCode (estilo Prisma) tampoco sale', async () => {
    const res = await app.inject({ method: 'GET', url: '/prisma' });
    expect(res.statusCode).toBe(500);
    expect(res.json().code).toBe('INTERNAL_ERROR');
    expect(res.body).not.toContain('P2002');
  });

  it('un 4xx conserva statusCode, code y message', async () => {
    const res = await app.inject({ method: 'GET', url: '/no-encontrado' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({
      code: 'X_404',
      message: 'No existe ese recurso',
      error: 'Not Found',
    });
  });

  it('la validación de Fastify (400) conserva su mensaje', async () => {
    const res = await app.inject({ method: 'POST', url: '/valida', payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain("must have required property 'a'");
    expect(res.json().code).toBe('FST_ERR_VALIDATION');
  });

  it('una ruta inexistente sigue siendo 404', async () => {
    expect((await app.inject({ method: 'GET', url: '/nada' })).statusCode).toBe(404);
  });
});
