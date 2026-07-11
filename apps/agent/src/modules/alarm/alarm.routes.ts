import type { ArmAlarmRequest, DisarmAlarmRequest, UpdateAlarmConfigRequest } from '@krakenos/types';
import type { FastifyPluginAsync } from 'fastify';
import { AlarmPinError, type AlarmService } from './alarm.service.js';
import {
  armAlarmSchema,
  disarmAlarmSchema,
  getAlarmConfigSchema,
  getAlarmStateSchema,
  updateAlarmConfigSchema,
} from './alarm.schemas.js';

interface AlarmRoutesOpts {
  alarm: AlarmService;
}

/**
 * Rutas de la alarma (US-188). **Estado**: lectura autenticada. **Armar/desarmar**:
 * capacidad `home.control` (admin+member; kid/guest **no** pueden) — el desarme
 * exige el PIN si está puesto, y se audita con actor+ip. **Config**: solo admin.
 */
export const alarmRoutes: FastifyPluginAsync<AlarmRoutesOpts> = async (app, opts) => {
  const { alarm } = opts;

  app.get('/', { schema: getAlarmStateSchema, preHandler: app.authenticate }, async () =>
    alarm.getState(),
  );

  app.post<{ Body: ArmAlarmRequest }>(
    '/arm',
    { schema: armAlarmSchema, preHandler: app.requireCapability('home.control') },
    async (req) => {
      const state = await alarm.armAlarm(req.body.mode, req.user.email);
      app.audit({ action: 'alarm.armed', userId: req.user.sub, detail: req.body.mode, ip: req.ip });
      return state;
    },
  );

  app.post<{ Body: DisarmAlarmRequest }>(
    '/disarm',
    { schema: disarmAlarmSchema, preHandler: app.requireCapability('home.control') },
    async (req, reply) => {
      try {
        const state = await alarm.disarmAlarm(req.body?.pin, req.user.email);
        app.audit({ action: 'alarm.disarmed', userId: req.user.sub, ip: req.ip });
        return state;
      } catch (err) {
        if (err instanceof AlarmPinError) {
          // Intento de desarme con PIN erróneo: se audita (señal de seguridad).
          app.audit({ action: 'alarm.disarm_denied', userId: req.user.sub, ip: req.ip });
          return reply.code(401).send({ code: err.code, message: 'PIN de desarme incorrecto' });
        }
        throw err;
      }
    },
  );

  app.get('/config', { schema: getAlarmConfigSchema, preHandler: app.requireRole('admin') }, async () =>
    alarm.getConfig(),
  );

  app.put<{ Body: UpdateAlarmConfigRequest }>(
    '/config',
    { schema: updateAlarmConfigSchema, preHandler: app.requireRole('admin') },
    async (req) => {
      const config = await alarm.setConfig(req.body);
      app.audit({ action: 'alarm.config', userId: req.user.sub, ip: req.ip });
      return config;
    },
  );
};
