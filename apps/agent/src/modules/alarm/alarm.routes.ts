import type { ArmAlarmRequest, DisarmAlarmRequest, UpdateAlarmConfigRequest } from '@krakenos/types';
import type { FastifyPluginAsync } from 'fastify';
import { alarmPinLockout } from './alarm.lockout.js';
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
    {
      schema: disarmAlarmSchema,
      // El plugin de rate-limit se registra con `global: false`, así que sin este
      // `config` la ruta del PIN no tenía NINGÚN límite (AUD3-03).
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      preHandler: app.requireCapability('home.control'),
    },
    async (req, reply) => {
      // Lockout por sujeto con backoff, además del límite por IP: frena la fuerza
      // bruta aunque el atacante cambie de IP o use un token de API.
      const retryAfter = alarmPinLockout.retryAfterSec(req.user.sub);
      if (retryAfter > 0) {
        void reply.header('Retry-After', String(retryAfter));
        return reply.code(429).send({
          code: 'ALARM_PIN_LOCKED',
          message: `Demasiados intentos con PIN incorrecto. Inténtalo de nuevo en ${retryAfter} s.`,
        });
      }
      try {
        const state = await alarm.disarmAlarm(req.body?.pin, req.user.email);
        alarmPinLockout.recordSuccess(req.user.sub);
        app.audit({ action: 'alarm.disarmed', userId: req.user.sub, ip: req.ip });
        return state;
      } catch (err) {
        if (err instanceof AlarmPinError) {
          alarmPinLockout.recordFailure(req.user.sub);
          // Intento de desarme con PIN erróneo: se audita **y ahora avisa** (está en
          // el catálogo de alertas desde US-227). Sin `detail`: el actor y la IP ya
          // quedan en la auditoría y el aviso puede salir a Telegram.
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
