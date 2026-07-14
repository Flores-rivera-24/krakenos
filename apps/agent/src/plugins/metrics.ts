import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { MetricsRegistry } from '../observability/metrics.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** Registro de métricas internas del agente (US-191). */
    metrics: MetricsRegistry;
  }
}

/** Cada cuánto se muestrea el retraso del event loop (ms). */
const LAG_INTERVAL_MS = 2000;

/**
 * Plugin de observabilidad (US-191). Instrumenta cada petición HTTP (latencia,
 * status, concurrencia en vuelo) y muestrea el retraso del event loop, dejando
 * todo en un `MetricsRegistry` en memoria expuesto como `app.metrics`. La ruta
 * `GET /api/system/metrics` (autenticada) lo lee; `/health` sigue mínimo y público.
 *
 * Va con `fastify-plugin` para que los hooks apliquen a TODAS las rutas (no solo a
 * las de este encapsulado) y el decorador esté disponible en todo el servidor.
 * El sampler del loop se limpia en `onClose` (hot-reload/cierre sin fugar timers).
 */
export const metricsPlugin = fp(async (app: FastifyInstance) => {
  const metrics = new MetricsRegistry();
  app.decorate('metrics', metrics);

  app.addHook('onRequest', async () => {
    metrics.incInFlight();
  });

  app.addHook('onResponse', async (_req, reply) => {
    metrics.recordHttp(reply.statusCode, reply.elapsedTime);
    metrics.decInFlight();
  });

  // Muestreo del retraso del event loop: un timer programado a `LAG_INTERVAL_MS`
  // que despierta tarde delata un loop bloqueado (el síntoma que perseguíamos con
  // el heatmap asíncrono). Registramos la diferencia entre el retraso real y el
  // esperado.
  let last = Date.now();
  const timer = setInterval(() => {
    const nowMs = Date.now();
    const lag = nowMs - last - LAG_INTERVAL_MS;
    metrics.recordLoopLag(Math.max(0, lag));
    last = nowMs;
  }, LAG_INTERVAL_MS);
  timer.unref?.();

  app.addHook('onClose', async () => {
    clearInterval(timer);
  });
});
