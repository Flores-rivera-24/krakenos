import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, type CollectedRoute } from '../helpers/app.js';

/**
 * Barrido de schemas: toda ruta de `/api` declara el suyo.
 *
 * Qué agujero tapa. CLAUDE.md exige JSON Schema en cada ruta, pero nada fallaba si
 * una ruta nueva no lo declaraba: sin `body`, el borde no valida (ni poda) lo que
 * llega; sin `params`, un `:id` entra sin comprobar; sin `response`, Fastify no
 * serializa por schema y un campo interno puede acabar en la respuesta.
 *
 * Reglas:
 *  - toda ruta `/api` declara `schema.response`;
 *  - toda `POST/PUT/PATCH` declara `schema.body`, salvo `SIN_BODY`;
 *  - toda ruta con `:param` declara `schema.params`.
 * Cada excepción lleva su motivo, y una entrada que ya no hace falta falla (el
 * allowlist no puede envejecer en silencio).
 */

/** Escrituras que no llevan cuerpo JSON (acciones sin payload o subidas binarias). */
const SIN_BODY = new Map<string, string>([
  ['POST /api/auth/refresh', 'sin cuerpo: el refresh token viaja en cookie httpOnly'],
  ['POST /api/auth/logout', 'sin cuerpo: lee la cookie de sesion'],
  [
    'POST /api/webauthn/register/options',
    'accion sin payload: opciones para el usuario autenticado',
  ],
  [
    'POST /api/webauthn/backup-codes',
    'accion sin payload: regenera los codigos del usuario autenticado',
  ],
  ['POST /api/inventory/rescan', 'accion sin payload'],
  ['POST /api/inventory/devices/:id/block', 'accion sin payload: el id va en la ruta'],
  ['POST /api/people/:id/resume', 'accion sin payload: el id va en la ruta'],
  ['POST /api/scenes/:id/run', 'accion sin payload: el id va en la ruta'],
  ['POST /api/discovery/scan', 'accion sin payload'],
  ['POST /api/discovery/suggestions/:id/adopt', 'accion sin payload: el id va en la ruta'],
  ['POST /api/system/support-bundle', 'accion sin payload'],
  ['POST /api/system/update/cancel', 'accion sin payload'],
  ['POST /api/system/connectivity-test', 'accion sin payload'],
  ['POST /api/system/regen-keys', 'accion sin payload'],
  ['POST /api/system/backup/auto/run', 'accion sin payload'],
  [
    'POST /api/system/backup/auto/passphrase/reveal',
    'accion sin payload (solo admin activo, auditada)',
  ],
  ['POST /api/system/restore/upload', 'subida binaria (stream), no JSON'],
  [
    'POST /api/cameras/:id/stream',
    'accion sin payload: emite el token de stream de la camara del id',
  ],
]);

/** Rutas sin `schema.response`, con su motivo. */
const SIN_RESPONSE = new Map<string, string>([
  ['GET /api/reports/audit.csv', 'respuesta CSV, no JSON'],
  ['GET /api/reports/devices.csv', 'respuesta CSV, no JSON'],
  ['GET /api/reports/traffic.csv', 'respuesta CSV, no JSON'],
  ['GET /api/reports/energy.csv', 'respuesta CSV, no JSON'],
  ['GET /api/cameras/:id/stream/index.m3u8', 'playlist HLS, no JSON'],
  ['GET /api/cameras/:id/stream/:segment', 'segmento de video, no JSON'],
  ['GET /api/cameras/recordings/:id/download', 'descarga binaria, no JSON'],
  ['DELETE /api/auth/sessions/:id', 'pendiente: declarar el schema response (204/errorResponse)'],
  ['POST /api/users/:id/password', 'pendiente: declarar el schema response'],
  ['DELETE /api/users/:id', 'pendiente: declarar el schema response'],
  ['POST /api/access-requests', 'pendiente: declarar el schema response (siempre 202, publica)'],
  ['DELETE /api/access/schedules/:id', 'pendiente: declarar el schema response'],
  ['DELETE /api/coverage/floorplans/:id', 'pendiente: declarar el schema response'],
  ['DELETE /api/coverage/scans/:scanId', 'pendiente: declarar el schema response'],
  ['POST /api/system/support-bundle', 'pendiente: declarar el schema response (descarga JSON)'],
  [
    'POST /api/system/backup',
    'pendiente: declarar el schema response (descarga de archivo cifrado)',
  ],
  ['POST /api/vlans', 'pendiente: declarar el schema response'],
  ['PATCH /api/vlans/:id', 'pendiente: declarar el schema response'],
]);

/** Rutas con `:param` sin `schema.params`, con su motivo. */
const SIN_PARAMS = new Map<string, string>([
  ['DELETE /api/auth/sessions/:id', 'pendiente: declarar el schema params'],
  ['PATCH /api/energy/alerts/:id', 'pendiente: declarar el schema params'],
  ['DELETE /api/energy/alerts/:id', 'pendiente: declarar el schema params'],
]);

describe('barrido de schemas por ruta (/api)', () => {
  let app: FastifyInstance;
  let rutas: CollectedRoute[];

  beforeAll(async () => {
    app = await buildTestApp({ routes: true });
    const todas = (app as unknown as { collectedRoutes: CollectedRoute[] }).collectedRoutes;
    // Fastify registra además HEAD (auto) y OPTIONS: duplican la ruta GET.
    const vistas = new Set<string>();
    rutas = todas.filter((r) => {
      const m = r.method.toUpperCase();
      if (!r.url.startsWith('/api') || m === 'HEAD' || m === 'OPTIONS') return false;
      const k = `${m} ${r.url}`;
      if (vistas.has(k)) return false;
      vistas.add(k);
      return true;
    });
  });

  afterAll(async () => {
    await app.close();
  });

  const clave = (r: CollectedRoute) => `${r.method.toUpperCase()} ${r.url}`;

  it('el barrido ve las rutas (guard de tamaño)', () => {
    // Si `onRoute` dejara de poblar la tabla, los demás tests pasarían vacíos.
    expect(rutas.length).toBeGreaterThan(100);
    expect(rutas.some((r) => r.schema.response)).toBe(true);
  });

  it('toda ruta declara schema.response', () => {
    const faltan = rutas
      .filter((r) => !r.schema.response && !SIN_RESPONSE.has(clave(r)))
      .map(clave);
    expect(faltan).toEqual([]);
  });

  it('toda escritura POST/PUT/PATCH declara schema.body', () => {
    const faltan = rutas
      .filter((r) => ['POST', 'PUT', 'PATCH'].includes(r.method.toUpperCase()))
      .filter((r) => !r.schema.body && !SIN_BODY.has(clave(r)))
      .map(clave);
    expect(faltan).toEqual([]);
  });

  it('toda ruta con :param declara schema.params', () => {
    const faltan = rutas
      .filter((r) => /:[A-Za-z]/.test(r.url) && !r.schema.params && !SIN_PARAMS.has(clave(r)))
      .map(clave);
    expect(faltan).toEqual([]);
  });

  it('los allowlists no tienen entradas muertas ni ya cumplidas', () => {
    const porClave = new Map(rutas.map((r) => [clave(r), r]));
    const sobran: string[] = [];
    for (const k of SIN_BODY.keys()) {
      const r = porClave.get(k);
      if (!r || r.schema.body) sobran.push(`SIN_BODY ${k}`);
    }
    for (const k of SIN_RESPONSE.keys()) {
      const r = porClave.get(k);
      if (!r || r.schema.response) sobran.push(`SIN_RESPONSE ${k}`);
    }
    for (const k of SIN_PARAMS.keys()) {
      const r = porClave.get(k);
      if (!r || r.schema.params) sobran.push(`SIN_PARAMS ${k}`);
    }
    expect(sobran).toEqual([]);
  });
});
