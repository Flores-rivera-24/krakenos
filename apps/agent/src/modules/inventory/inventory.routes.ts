import type { HardwareDriver, UpdateDeviceRequest } from '@krakenos/types';
import { INVENTORY_ROOM } from '@krakenos/types';
import type { FastifyPluginAsync } from 'fastify';
import { InventoryService } from './inventory.service.js';
import {
  blockDeviceSchema,
  listDevicesSchema,
  rescanSchema,
  setVlanSchema,
  updateDeviceSchema,
} from './inventory.schemas.js';

interface InventoryRoutesOpts {
  driver: HardwareDriver;
  /** Instancia compartida (la crea `server.ts` para reusarla en otros módulos). */
  service?: InventoryService;
}

export const inventoryRoutes: FastifyPluginAsync<InventoryRoutesOpts> = async (app, opts) => {
  const service = opts.service ?? new InventoryService(app, opts.driver);

  // Todas las rutas de inventario requieren autenticación; las de escritura, rol admin.
  app.addHook('preHandler', app.authenticate);
  const adminOnly = app.requireRole('admin');

  app.get('/devices', { schema: listDevicesSchema }, async () => {
    return service.list();
  });

  // Editar metadatos (etiqueta/tipo/notas) es una escritura → solo admin (antes
  // quedaba accesible a un viewer por error; corregido en US-89).
  app.patch<{ Params: { id: string }; Body: UpdateDeviceRequest }>(
    '/devices/:id',
    { schema: updateDeviceSchema, preHandler: adminOnly },
    async (req, reply) => {
      const device = await service.updateMetadata(req.params.id, req.body);
      if (!device) {
        return reply.code(404).send({ code: 'DEVICE_NOT_FOUND', message: 'Dispositivo no encontrado' });
      }
      app.audit({ action: 'device.update', userId: req.user.sub, detail: device.mac, ip: req.ip });
      return reply.send(device);
    },
  );

  // Rescan: acción de refresco; cualquier usuario autenticado (igual que el evento
  // de socket `inventory:rescan`), no muta configuración persistente del usuario.
  app.post('/rescan', { schema: rescanSchema }, async () => {
    return service.scan();
  });

  app.post<{ Params: { id: string } }>(
    '/devices/:id/block',
    { schema: blockDeviceSchema, preHandler: adminOnly },
    async (req, reply) => {
      const device = await service.setBlocked(req.params.id, true);
      if (!device) {
        return reply.code(404).send({ code: 'DEVICE_NOT_FOUND', message: 'Dispositivo no encontrado' });
      }
      app.audit({ action: 'device.block', userId: req.user.sub, detail: device.mac, ip: req.ip });
      return reply.send(device);
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/devices/:id/block',
    { schema: blockDeviceSchema, preHandler: adminOnly },
    async (req, reply) => {
      const device = await service.setBlocked(req.params.id, false);
      if (!device) {
        return reply.code(404).send({ code: 'DEVICE_NOT_FOUND', message: 'Dispositivo no encontrado' });
      }
      app.audit({ action: 'device.unblock', userId: req.user.sub, detail: device.mac, ip: req.ip });
      return reply.send(device);
    },
  );

  // Asignación de VLAN — operación privilegiada (solo admin).
  app.put<{ Params: { id: string }; Body: { tag: number | null } }>(
    '/devices/:id/vlan',
    { schema: setVlanSchema, preHandler: adminOnly },
    async (req, reply) => {
      const device = await service.setVlan(req.params.id, req.body.tag);
      if (!device) {
        return reply.code(404).send({ code: 'DEVICE_NOT_FOUND', message: 'Dispositivo no encontrado' });
      }
      app.audit({
        action: 'device.vlan',
        userId: req.user.sub,
        detail: `${device.mac} → ${req.body.tag ?? 'sin VLAN'}`,
        ip: req.ip,
      });
      return reply.send(device);
    },
  );

  // Entrega un snapshot a cada cliente que se une al room de inventario.
  app.io.on('connection', (socket) => {
    socket.on('inventory:rescan', () => {
      void service.scan();
    });
    void socket.join(INVENTORY_ROOM);
    void service.list().then((devices) => socket.emit('inventory:snapshot', devices));
  });
};
