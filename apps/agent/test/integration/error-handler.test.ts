import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerErrorHandler } from '../../src/plugins/error-handler.js';
import Fastify from 'fastify';
import { errorResponse } from '../../src/modules/common.schemas.js';

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
    app.post(
      '/valida-con-400',
      {
        schema: {
          body: {
            type: 'object',
            required: ['a'],
            properties: { a: { type: 'string', minLength: 1, maxLength: 5 } },
          },
          response: { 400: errorResponse },
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

  it('la validación (400) responde con código estable y detalle por campo, sin el texto de Ajv', async () => {
    const res = await app.inject({ method: 'POST', url: '/valida', payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      statusCode: 400,
      code: 'VALIDATION',
      error: 'Bad Request',
      message: 'Algunos datos no son válidos. Revisa el formulario.',
      details: { field: 'a', rule: 'required' },
    });
    expect(res.body).not.toMatch(/must |body\//);
  });

  it('la validación lleva el límite cuando la regla lo tiene', async () => {
    const vacio = await app.inject({ method: 'POST', url: '/valida-con-400', payload: { a: '' } });
    expect(vacio.json().details).toEqual({ field: 'a', rule: 'minLength', limit: 1 });
    const largo = await app.inject({
      method: 'POST',
      url: '/valida-con-400',
      payload: { a: 'abcdefg' },
    });
    expect(largo.json().details).toEqual({ field: 'a', rule: 'maxLength', limit: 5 });
  });

  it('el schema de respuesta errorResponse conserva el detalle (details)', async () => {
    const res = await app.inject({ method: 'POST', url: '/valida-con-400', payload: {} });
    expect(res.json()).toEqual({
      code: 'VALIDATION',
      message: 'Algunos datos no son válidos. Revisa el formulario.',
      details: { field: 'a', rule: 'required' },
    });
  });

  it('una ruta inexistente sigue siendo 404', async () => {
    expect((await app.inject({ method: 'GET', url: '/nada' })).statusCode).toBe(404);
  });
});
