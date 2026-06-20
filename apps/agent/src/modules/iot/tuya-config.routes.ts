import type { FastifyPluginAsync } from 'fastify';
import {
  toPublicTuyaDevice,
  toTuyaRecord,
  type TuyaDeviceConfig,
  type TuyaStore,
} from '../../iot/tuya.store.js';
import {
  createTuyaSchema,
  listTuyaSchema,
  removeTuyaSchema,
  updateTuyaSchema,
} from './tuya-config.schemas.js';

interface TuyaConfigRoutesOpts {
  store: TuyaStore;
}

/** Cuerpo de creación: la config completa de un dispositivo Tuya. */
type CreateBody = TuyaDeviceConfig;
/** Cuerpo de actualización: campos editables (la `localKey` se puede rotar). */
type UpdateBody = Partial<Pick<TuyaDeviceConfig, 'ip' | 'localKey' | 'name'>>;

/**
 * Gestión de la config de dispositivos Tuya (solo admin). La `localKey` es una
 * credencial sensible: se acepta al crear/actualizar pero **nunca** se devuelve.
 */
export const tuyaConfigRoutes: FastifyPluginAsync<TuyaConfigRoutesOpts> = async (app, opts) => {
  const { store } = opts;
  // Toda la gestión de credenciales de dispositivos es solo admin.
  app.addHook('preHandler', app.requireRole('admin'));

  app.get('/devices', { schema: listTuyaSchema }, async () => {
    return (await store.list()).map(toPublicTuyaDevice);
  });

  app.post<{ Body: CreateBody }>('/devices', { schema: createTuyaSchema }, async (req, reply) => {
    const record = toTuyaRecord(req.body);
    await store.upsert(record);
    app.audit({ action: 'iot.tuya.add', userId: req.user.sub, detail: record.deviceId, ip: req.ip });
    return reply.code(201).send(toPublicTuyaDevice(record));
  });

  app.patch<{ Params: { deviceId: string }; Body: UpdateBody }>(
    '/devices/:deviceId',
    { schema: updateTuyaSchema },
    async (req, reply) => {
      const existing = await store.get(req.params.deviceId);
      if (!existing) {
        return reply.code(404).send({ code: 'TUYA_NOT_FOUND', message: 'Dispositivo no encontrado' });
      }
      const updated = { ...existing, ...req.body };
      await store.upsert(updated);
      app.audit({ action: 'iot.tuya.update', userId: req.user.sub, detail: updated.deviceId, ip: req.ip });
      return toPublicTuyaDevice(updated);
    },
  );

  app.delete<{ Params: { deviceId: string } }>(
    '/devices/:deviceId',
    { schema: removeTuyaSchema },
    async (req, reply) => {
      const removed = await store.removeById(req.params.deviceId);
      if (!removed) {
        return reply.code(404).send({ code: 'TUYA_NOT_FOUND', message: 'Dispositivo no encontrado' });
      }
      app.audit({ action: 'iot.tuya.remove', userId: req.user.sub, detail: req.params.deviceId, ip: req.ip });
      return reply.code(204).send();
    },
  );
};
