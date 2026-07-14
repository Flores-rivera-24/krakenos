import type { CreateFavoriteRequest, ReorderFavoritesRequest } from '@krakenos/types';
import type { FastifyPluginAsync } from 'fastify';
import { FavoriteLimitError, FavoriteService } from './favorites.service.js';
import {
  createFavoriteSchema,
  deleteFavoriteSchema,
  listFavoritesSchema,
  reorderFavoritesSchema,
} from './favorites.schemas.js';

interface FavoritesRoutesOpts {
  service?: FavoriteService;
}

/**
 * Favoritos por usuario (US-170). Autoservicio: cualquier usuario autenticado
 * gestiona **los suyos** (como las suscripciones push, US-45); no hay rol admin
 * porque cada quien solo toca sus propios favoritos, acotados por `req.user.sub`.
 */
export const favoritesRoutes: FastifyPluginAsync<FavoritesRoutesOpts> = async (app, opts) => {
  const service = opts.service ?? new FavoriteService(app);

  app.addHook('preHandler', app.authenticate);

  app.get('/', { schema: listFavoritesSchema }, async (req) => service.list(req.user.sub));

  app.post<{ Body: CreateFavoriteRequest }>('/', { schema: createFavoriteSchema }, async (req, reply) => {
    try {
      const favorite = await service.create(req.user.sub, req.body);
      return reply.code(201).send(favorite);
    } catch (err) {
      if (err instanceof FavoriteLimitError) {
        return reply.code(413).send({ code: err.code, message: err.message });
      }
      throw err;
    }
  });

  app.delete<{ Params: { id: string } }>(
    '/:id',
    { schema: deleteFavoriteSchema },
    async (req, reply) => {
      const ok = await service.remove(req.user.sub, req.params.id);
      if (!ok) {
        return reply.code(404).send({ code: 'NOT_FOUND', message: 'Favorito no encontrado' });
      }
      return reply.code(204).send();
    },
  );

  app.put<{ Body: ReorderFavoritesRequest }>(
    '/order',
    { schema: reorderFavoritesSchema },
    async (req) => service.reorder(req.user.sub, req.body.ids),
  );
};
