import type { CreateFavoriteRequest, Favorite } from '@krakenos/types';
import { FAVORITE_KINDS } from '@krakenos/types';
import type { Favorite as DbFavorite } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { asEnum } from '../../util/as-enum.js';

/** Máximo de favoritos por usuario (AUD-19): sin retención que pode esta tabla. */
export const MAX_FAVORITES_PER_USER = 100;

/** Se lanza al superar la cota de favoritos; la ruta la mapea a 413. */
export class FavoriteLimitError extends Error {
  readonly code = 'FAVORITE_LIMIT';
  constructor() {
    super(`Máximo ${MAX_FAVORITES_PER_USER} favoritos por usuario`);
    this.name = 'FavoriteLimitError';
  }
}

function toFavorite(row: DbFavorite): Favorite {
  return {
    id: row.id,
    kind: asEnum(row.kind, FAVORITE_KINDS, 'device'),
    ref: row.ref,
    order: row.order,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Favoritos por usuario (US-170). Cada usuario fija sus dispositivos/escenas más
 * usados para el widget de acciones rápidas del dashboard. Autoservicio: todas
 * las operaciones van acotadas al `userId` de la sesión — un usuario nunca ve ni
 * toca los favoritos de otro.
 */
export class FavoriteService {
  constructor(private readonly app: FastifyInstance) {}

  async list(userId: string): Promise<Favorite[]> {
    const rows = await this.app.prisma.favorite.findMany({
      where: { userId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map(toFavorite);
  }

  /**
   * Fija un favorito. Idempotente: si ya existe (mismo kind+ref para el usuario)
   * devuelve el existente en vez de duplicar. El `order` por defecto lo coloca al
   * final para no reordenar los ya fijados.
   */
  async create(userId: string, body: CreateFavoriteRequest): Promise<Favorite> {
    const existing = await this.app.prisma.favorite.findUnique({
      where: { userId_kind_ref: { userId, kind: body.kind, ref: body.ref } },
    });
    if (existing) return toFavorite(existing);

    // Cota por usuario (AUD-19): sin retención que pode esta tabla, un viewer podría
    // scriptear filas sin límite. 100 favoritos es de sobra para un uso humano.
    const count = await this.app.prisma.favorite.count({ where: { userId } });
    if (count >= MAX_FAVORITES_PER_USER) {
      throw new FavoriteLimitError();
    }

    let order = body.order;
    if (order === undefined) {
      const last = await this.app.prisma.favorite.findFirst({
        where: { userId },
        orderBy: { order: 'desc' },
      });
      order = (last?.order ?? -1) + 1;
    }

    const row = await this.app.prisma.favorite.create({
      data: { userId, kind: body.kind, ref: body.ref, order },
    });
    return toFavorite(row);
  }

  /** Quita un favorito del usuario. Devuelve `false` si no existe o no es suyo. */
  async remove(userId: string, id: string): Promise<boolean> {
    const existing = await this.app.prisma.favorite.findFirst({ where: { id, userId } });
    if (!existing) return false;
    await this.app.prisma.favorite.delete({ where: { id } });
    return true;
  }

  /**
   * Reordena los favoritos del usuario según la lista de ids dada. Solo toca los
   * ids que le pertenecen (ignora ids ajenos/inexistentes, sin fallar); los no
   * mencionados conservan su orden relativo tras los reordenados.
   */
  async reorder(userId: string, ids: string[]): Promise<Favorite[]> {
    const owned = await this.app.prisma.favorite.findMany({ where: { userId }, select: { id: true } });
    const ownedIds = new Set(owned.map((f) => f.id));
    await this.app.prisma.$transaction(
      ids
        .filter((id) => ownedIds.has(id))
        .map((id, index) =>
          this.app.prisma.favorite.update({ where: { id }, data: { order: index } }),
        ),
    );
    return this.list(userId);
  }
}
