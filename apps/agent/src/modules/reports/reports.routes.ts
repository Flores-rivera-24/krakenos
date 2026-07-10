import type { EnergyRange, TrafficRange } from '@krakenos/types';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import type { ReportsService } from './reports.service.js';

interface ReportsRoutesOpts {
  service: ReportsService;
}

const trafficRangeSchema = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: { range: { type: 'string', enum: ['hour', 'day', 'week', 'month'] } },
  },
} as const;

const energyRangeSchema = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: { range: { type: 'string', enum: ['day', 'week', 'month'] } },
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

  // El log de auditoría es admin-only (igual que `GET /api/audit`): vuelca IPs,
  // actorIds y eventos de seguridad. Antes bastaba `authenticate`, así que un
  // `viewer` lo descargaba por CSV pese a tener 403 en la página de auditoría.
  app.get('/audit.csv', { preHandler: app.requireRole('admin') }, async (_req, reply) =>
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

  // Consumo eléctrico por dispositivo en la ventana (US-182).
  app.get<{ Querystring: { range?: EnergyRange } }>(
    '/energy.csv',
    { schema: energyRangeSchema, preHandler: app.authenticate },
    async (req, reply) =>
      sendCsv(reply, 'krakenos-energia.csv', await service.energyCsv(req.query.range ?? 'week')),
  );
};
