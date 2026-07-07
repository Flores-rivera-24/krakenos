import type { IsoDateTime } from './common.js';

/** Tipo de entidad que se puede fijar como favorita (US-170). */
export type FavoriteKind = 'device' | 'iot' | 'room' | 'scene';

/**
 * Favorito de un usuario: un dispositivo, IoT, habitación o escena fijado para
 * acceso rápido en el dashboard (US-170). Es **por usuario** (cada quien fija lo
 * suyo). `ref` es el id de la entidad en su dominio (id de `Device`/`Room`, id
 * del `IotManager`, etc.).
 */
export interface Favorite {
  id: string;
  kind: FavoriteKind;
  ref: string;
  /** Orden de presentación (asc); a igualdad, por antigüedad. */
  order: number;
  createdAt: IsoDateTime;
}

/** Alta de favorito (`POST /api/favorites`). */
export interface CreateFavoriteRequest {
  kind: FavoriteKind;
  ref: string;
  order?: number;
}

/** Reordenar los favoritos del usuario (`PUT /api/favorites/order`). */
export interface ReorderFavoritesRequest {
  /** Ids de favoritos en el nuevo orden. */
  ids: string[];
}
