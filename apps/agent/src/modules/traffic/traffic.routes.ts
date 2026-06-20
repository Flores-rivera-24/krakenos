import type { TrafficRange } from '@krakenos/types';
import { TRAFFIC_ROOM } from '@krakenos/types';
import type { FastifyPluginAsync } from 'fastify';
import type { TrafficService } from './traffic.service.js';
import {
  deviceTrafficSchema,
  trafficHistorySchema,
  trafficStatsSchema,
} from './traffic.schemas.js';

interface TrafficRoutesOpts {
  service: TrafficService;
}

export const trafficRoutes: FastifyPluginAsync<TrafficRoutesOpts> = async (app, opts) => {
  const { service } = opts;

  app.get('/history', { schema: trafficHistorySchema, preHandler: app.authenticate }, async () => {
    return service.getHistory();
  });

  app.get<{ Querystring: { range?: TrafficRange } }>(
    '/stats',
    { schema: trafficStatsSchema, preHandler: app.authenticate },
    async (req) => {
      return service.getStats(req.query.range ?? 'day');
    },
  );

  // Tráfico agregado por dispositivo en la ventana indicada (US-46).
  app.get<{ Querystring: { range?: TrafficRange } }>(
    '/devices',
    { schema: deviceTrafficSchema, preHandler: app.authenticate },
    async (req) => {
      return service.getDeviceStats(req.query.range ?? 'hour');
    },
  );

  // Cada cliente se une al room de tráfico y recibe el histórico reciente.
  app.io.on('connection', (socket) => {
    void socket.join(TRAFFIC_ROOM);
    socket.emit('traffic:history', service.getHistory());
  });
};
