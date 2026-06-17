import type {
  CreateVlanRequest,
  UpdateVlanRequest,
  Vlan,
  VlanManager,
  VlanWithCount,
} from '@krakenos/types';
import type { FastifyPluginAsync } from 'fastify';
import { VlanError } from '../../vlan/mock.vlan.js';
import {
  createVlanSchema,
  listVlansSchema,
  removeVlanSchema,
  updateVlanSchema,
} from './vlan.schemas.js';

interface VlanRoutesOpts {
  vlan: VlanManager;
}

export const vlanRoutes: FastifyPluginAsync<VlanRoutesOpts> = async (app, opts) => {
  const { vlan } = opts;

  // Lectura: cualquier usuario autenticado. Escritura: solo admin.
  app.addHook('preHandler', app.authenticate);
  const adminOnly = app.requireRole('admin');

  /** Añade el nº de dispositivos asignados (por tag) a cada VLAN. */
  const withCounts = async (vlans: Vlan[]): Promise<VlanWithCount[]> => {
    return Promise.all(
      vlans.map(async (v) => ({
        ...v,
        deviceCount: await app.prisma.device.count({ where: { vlanTag: v.tag } }),
      })),
    );
  };

  app.get('/', { schema: listVlansSchema }, async () => {
    return withCounts(await vlan.listVlans());
  });

  app.post<{ Body: CreateVlanRequest }>(
    '/',
    { schema: createVlanSchema, preHandler: adminOnly },
    async (req, reply) => {
      try {
        const created = await vlan.createVlan(req.body);
        app.audit({ action: 'vlan.create', userId: req.user.sub, detail: `${created.tag}`, ip: req.ip });
        const [withCount] = await withCounts([created]);
        return reply.code(201).send(withCount);
      } catch (err) {
        if (err instanceof VlanError && err.code === 'VLAN_TAG_TAKEN') {
          return reply.code(409).send({ code: err.code, message: err.message });
        }
        throw err;
      }
    },
  );

  app.patch<{ Params: { id: string }; Body: UpdateVlanRequest }>(
    '/:id',
    { schema: updateVlanSchema, preHandler: adminOnly },
    async (req, reply) => {
      const updated = await vlan.updateVlan(req.params.id, req.body);
      if (!updated) {
        return reply.code(404).send({ code: 'VLAN_NOT_FOUND', message: 'VLAN no encontrada' });
      }
      app.audit({ action: 'vlan.update', userId: req.user.sub, detail: `${updated.tag}`, ip: req.ip });
      const [withCount] = await withCounts([updated]);
      return withCount;
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/:id',
    { schema: removeVlanSchema, preHandler: adminOnly },
    async (req, reply) => {
      const existing = await vlan.getVlan(req.params.id);
      const removed = await vlan.removeVlan(req.params.id);
      if (!removed || !existing) {
        return reply.code(404).send({ code: 'VLAN_NOT_FOUND', message: 'VLAN no encontrada' });
      }
      // Desasigna los dispositivos que pertenecían a esta VLAN.
      await app.prisma.device.updateMany({
        where: { vlanTag: existing.tag },
        data: { vlanTag: null },
      });
      app.audit({ action: 'vlan.delete', userId: req.user.sub, detail: `${existing.tag}`, ip: req.ip });
      return reply.code(204).send();
    },
  );
};
