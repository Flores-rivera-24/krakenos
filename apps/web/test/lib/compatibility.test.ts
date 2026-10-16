import {
  APP_DEPENDENCY_REASONS,
  COMPAT_CAPABILITIES,
  COMPAT_CATEGORIES,
  COMPAT_REQUIREMENTS,
} from '@krakenos/types';
import { describe, expect, it } from 'vitest';
import {
  ETIQUETA_DE_CAPACIDAD,
  ETIQUETA_DE_CATEGORIA,
  ETIQUETA_DE_DEPENDENCIA,
  ETIQUETA_DE_REQUISITO,
  etiquetaCompat,
} from '@/lib/compatibility';
import { en } from '@/lib/i18n/catalog/en';
import { es } from '@/lib/i18n/catalog/es';
import { t } from '@/lib/i18n';

/**
 * Las etiquetas de la ficha de compatibilidad salen de mapas exhaustivos sobre la
 * unión del contrato. El tipo ya impide que falte una entrada; este test ata lo que
 * el tipo no ve: que la CLAVE exista en los dos catálogos (el cast de plantilla que
 * había antes compilaba aunque `compat.cap.traffic-per-device` no existiera).
 */
describe('etiquetas de compatibilidad', () => {
  const MAPAS = [
    ['capacidad', COMPAT_CAPABILITIES, ETIQUETA_DE_CAPACIDAD],
    ['requisito', COMPAT_REQUIREMENTS, ETIQUETA_DE_REQUISITO],
    ['categoría', COMPAT_CATEGORIES, ETIQUETA_DE_CATEGORIA],
    ['dependencia', APP_DEPENDENCY_REASONS, ETIQUETA_DE_DEPENDENCIA],
  ] as const;

  it.each(MAPAS)('cada %s del contrato tiene clave en es y en en', (_n, valores, mapa) => {
    // Guard de tamaño: si la lista del contrato se vaciara, el test no probaría nada.
    expect(valores.length).toBeGreaterThanOrEqual(3);
    const m = mapa as Record<string, string>;
    for (const v of valores) {
      const key = m[v];
      expect(key, `sin entrada para ${v}`).toBeTruthy();
      expect(Object.keys(es), `es:${key}`).toContain(key);
      expect(Object.keys(en), `en:${key}`).toContain(key);
    }
  });

  it('«tráfico por dispositivo» se traduce, no sale la clave', () => {
    expect(etiquetaCompat(ETIQUETA_DE_CAPACIDAD, 'traffic-per-device', t)).toBe(
      'Tráfico por dispositivo',
    );
  });

  it('un valor que la web no conoce se DECLARA, no se pinta crudo', () => {
    const texto = etiquetaCompat(ETIQUETA_DE_CAPACIDAD, 'teletransporte', t);
    expect(texto).toBe('No reconocido (teletransporte)');
    // Ni la clave del catálogo ni una entrada heredada del prototipo.
    expect(etiquetaCompat(ETIQUETA_DE_CAPACIDAD, 'constructor', t)).toBe(
      'No reconocido (constructor)',
    );
  });
});
