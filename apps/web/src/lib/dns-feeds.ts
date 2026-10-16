import type { DnsFeedId } from '@krakenos/types';
import type { TranslationKey } from '@/lib/i18n';

/**
 * Texto de cada lista por categoría. El agente manda el **id** del feed y no su
 * nombre ni su descripción (escritos en español no se podían traducir).
 *
 * `Record<DnsFeedId, …>` **exhaustivo a propósito**: un feed nuevo en
 * `DNS_FEED_IDS` no compila hasta darle texto aquí, y la clave no existe hasta
 * estar en los dos catálogos de idioma.
 */
export const TEXTO_DE_LISTA_DNS: Record<
  DnsFeedId,
  { name: TranslationKey; description: TranslationKey }
> = {
  ads: { name: 'dns.feed.ads.name', description: 'dns.feed.ads.description' },
  malware: { name: 'dns.feed.malware.name', description: 'dns.feed.malware.description' },
  'tracking-extended': {
    name: 'dns.feed.tracking-extended.name',
    description: 'dns.feed.tracking-extended.description',
  },
};

/**
 * Claves de un feed, o `null` si no está en el catálogo. `id` viene del servidor:
 * un agente más nuevo puede anunciar una lista que esta web no conoce, y pintar
 * `new-list` crudo es peor que decir que no se reconoce.
 */
export function textoDeListaDns(id: string): (typeof TEXTO_DE_LISTA_DNS)[DnsFeedId] | null {
  return Object.prototype.hasOwnProperty.call(TEXTO_DE_LISTA_DNS, id)
    ? TEXTO_DE_LISTA_DNS[id as DnsFeedId]
    : null;
}
