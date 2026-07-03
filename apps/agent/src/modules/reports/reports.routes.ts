import type { TrafficRange } from '@krakenos/types';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import type { ReportsService } from './reports.service.js';

interface ReportsRoutesOpts {
  service: ReportsService;
}

const trafficRangeSchema = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: { range: { type: 'string', enum: ['hour', 'day', 'week'] } },
  },
} as const;

function sendCsv(reply: FastifyReply, filename: string, csv: string): FastifyReply {
  return reply
    .header('content-type', 'text/csv; charset=utf-8')
    .header('content-disposition', `attachment; filename="${filename}"`)
    .send(csv);
}

/**
 * Informes exportables en CSV (US-109). Lectura autenticada (como la auditoría en
 * vivo). Sin schema de `response`: el cuerpo es texto CSV, no JSON.
 */
export const reportsRoutes: FastifyPluginAsync<ReportsRoutesOpts> = async (app, opts) => {
  const { service } = opts;

  app.get('/audit.csv', { preHandler: app.authenticate }, async (_req, reply) =>
    sendCsv(reply, 'krakenos-auditoria.csv', await service.auditCsv()),
  );

  app.get('/devices.csv', { preHandler: app.authenticate }, async (_req, reply) =>
    sendCsv(reply, 'krakenos-dispositivos.csv', await service.devicesCsv()),
  );

  app.get<{ Querystring: { range?: TrafficRange } }>(
    '/traffic.csv',
    { schema: trafficRangeSchema, preHandler: app.authenticate },
    async (req, reply) =>
      sendCsv(reply, 'krakenos-trafico.csv', await service.trafficCsv(req.query.range ?? 'week')),
  );
};
