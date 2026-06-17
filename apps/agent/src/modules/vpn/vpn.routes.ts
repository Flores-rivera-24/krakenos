import type { CreatePeerRequest, VpnManager } from '@krakenos/types';
import type { FastifyPluginAsync } from 'fastify';
import {
  createPeerSchema,
  listPeersSchema,
  removePeerSchema,
  vpnStatusSchema,
} from './vpn.schemas.js';

interface VpnRoutesOpts {
  vpn: VpnManager;
}

export const vpnRoutes: FastifyPluginAsync<VpnRoutesOpts> = async (app, opts) => {
  const { vpn } = opts;
  // Toda la gestión de VPN es privilegiada: solo admin.
  app.addHook('preHandler', app.requireRole('admin'));

  app.get('/status', { schema: vpnStatusSchema }, async () => {
    return vpn.getStatus();
  });

  app.get('/peers', { schema: listPeersSchema }, async () => {
    return vpn.listPeers();
  });

  app.post<{ Body: CreatePeerRequest }>('/peers', { schema: createPeerSchema }, async (req, reply) => {
    const result = await vpn.createPeer(req.body);
    app.audit({
      action: 'vpn.peer.add',
      userId: req.user.sub,
      detail: result.peer.name,
      ip: req.ip,
    });
    return reply.code(201).send(result);
  });

  app.delete<{ Params: { id: string } }>(
    '/peers/:id',
    { schema: removePeerSchema },
    async (req, reply) => {
      const removed = await vpn.removePeer(req.params.id);
      if (!removed) {
        return reply.code(404).send({ code: 'PEER_NOT_FOUND', message: 'Peer no encontrado' });
      }
      app.audit({ action: 'vpn.peer.remove', userId: req.user.sub, detail: req.params.id, ip: req.ip });
      return reply.code(204).send();
    },
  );
};
