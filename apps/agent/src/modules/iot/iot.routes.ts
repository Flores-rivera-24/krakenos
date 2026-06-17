import type { IotManager, UpdateIotStateRequest } from '@krakenos/types';
import { IOT_ROOM } from '@krakenos/types';
import type { FastifyPluginAsync } from 'fastify';
import { IotError } from '../../iot/index.js';
import { listIotSchema, updateIotSchema } from './iot.schemas.js';

interface IotRoutesOpts {
  iot: IotManager;
}

export const iotRoutes: FastifyPluginAsync<IotRoutesOpts> = async (app, opts) => {
  const { iot } = opts;

  app.addHook('preHandler', app.authenticate);

  app.get('/devices', { schema: listIotSchema }, async () => {
    return iot.listDevices();
  });

  app.patch<{ Params: { id: string }; Body: UpdateIotStateRequest }>(
    '/devices/:id',
    { schema: updateIotSchema, preHandler: app.requireRole('admin') },
    async (req, reply) => {
      try {
        const device = await iot.setState(req.params.id, req.body);
        app.io.to(IOT_ROOM).emit('iot:device-updated', device);
        app.audit({ action: 'iot.device.update', userId: req.user.sub, detail: device.id, ip: req.ip });
        return reply.send(device);
      } catch (err) {
        if (err instanceof IotError) {
          const status = err.code === 'IOT_NOT_FOUND' ? 404 : 400;
          return reply.code(status).send({ code: err.code, message: err.message });
        }
        throw err;
      }
    },
  );

  // Snapshot de IoT a cada cliente que se conecta.
  app.io.on('connection', (socket) => {
    void socket.join(IOT_ROOM);
    void iot.listDevices().then((devices) => socket.emit('iot:snapshot', devices));
  });
};
