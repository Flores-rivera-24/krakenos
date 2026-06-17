import os from 'node:os';
import type { SystemStats } from '@krakenos/types';
import type { FastifyPluginAsync } from 'fastify';
import { systemStatsSchema } from './system.schemas.js';

function readStats(): SystemStats {
  const cores = os.cpus().length || 1;
  const load1 = os.loadavg()[0] ?? 0;
  const totalBytes = os.totalmem();
  const usedBytes = totalBytes - os.freemem();

  return {
    uptimeSeconds: Math.round(os.uptime()),
    cpu: {
      cores,
      loadPercent: Math.min(100, Math.round((load1 / cores) * 100)),
    },
    memory: {
      totalBytes,
      usedBytes,
      usedPercent: Math.round((usedBytes / totalBytes) * 100),
    },
    timestamp: new Date().toISOString(),
  };
}

export const systemRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);

  app.get('/stats', { schema: systemStatsSchema }, async () => readStats());
};
