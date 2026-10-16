import { DNS_FEED_IDS } from '@krakenos/types';
import { describe, expect, it } from 'vitest';
import { TEXTO_DE_LISTA_DNS, textoDeListaDns } from '@/lib/dns-feeds';
import { en } from '@/lib/i18n/catalog/en';
import { es } from '@/lib/i18n/catalog/es';

describe('textos de las listas por categoría de DNS', () => {
  it('cada feed del contrato tiene nombre y descripción en es y en en', () => {
    // Guard: si la lista del contrato se vaciara, el test no probaría nada.
    expect(DNS_FEED_IDS.length).toBeGreaterThanOrEqual(3);
    for (const id of DNS_FEED_IDS) {
      const texto = TEXTO_DE_LISTA_DNS[id];
      for (const key of [texto.name, texto.description]) {
        expect(Object.keys(es), `es:${key}`).toContain(key);
        expect(Object.keys(en), `en:${key}`).toContain(key);
      }
    }
  });

  it('un id fuera del catálogo devuelve null (también los del prototipo)', () => {
    expect(textoDeListaDns('ads')).not.toBeNull();
    expect(textoDeListaDns('nueva')).toBeNull();
    expect(textoDeListaDns('constructor')).toBeNull();
  });
});
