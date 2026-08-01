import type { IotMetric } from '@krakenos/types';
import { IOT_METRICS } from '@krakenos/types';
import { describe, expect, it } from 'vitest';
import { beforeAll } from 'vitest';
import { METRIC_LABEL, describeReading, esLecturaDeEstado } from '@/lib/iot-readings';
import { ensureCatalog, setLocale, t } from '@/lib/i18n';

// US-262: `en` ya no viaja en el bundle y `setLocale` es SÍNCRONO, así que el
// catálogo se precarga aquí (el setup global no lo hace: costaba +19 % de setup
// a los 129 ficheros para que pasaran unos pocos tests).
beforeAll(() => ensureCatalog('en'));

/**
 * US-244. Lo que se prueba no es el formateo por el formateo: es que un `0` o un
 * `1` de un sensor de contacto **nunca** lleguen crudos a la pantalla. «1» debajo
 * de «Puerta de entrada» no informa de nada.
 */
describe('describeReading (US-244)', () => {
  it('una magnitud se enseña con su número y su unidad', () => {
    expect(describeReading({ metric: 'temperature', value: 21.5, unit: '°C' }, t)).toEqual({
      value: '21.5',
      unit: '°C',
    });
  });

  it('redondea a un decimal (un sensor no necesita cinco)', () => {
    expect(describeReading({ metric: 'temperature', value: 21.53333, unit: '°C' }, t).value).toBe(
      '21.5',
    );
  });

  it('un suceso se enseña con una palabra, no con un número', () => {
    expect(describeReading({ metric: 'contact', value: 1, unit: '' }, t)).toEqual({
      value: 'Abierta',
      unit: '',
    });
    expect(describeReading({ metric: 'contact', value: 0, unit: '' }, t).value).toBe('Cerrada');
    expect(describeReading({ metric: 'smoke', value: 1, unit: '' }, t).value).toBe('Humo detectado');
    expect(describeReading({ metric: 'occupancy', value: 0, unit: '' }, t).value).toBe(
      'Sin presencia',
    );
  });

  it('ninguna métrica de suceso deja escapar un número crudo', () => {
    for (const metric of ['contact', 'occupancy', 'smoke', 'co'] as IotMetric[]) {
      for (const value of [0, 1]) {
        const { value: texto } = describeReading({ metric, value, unit: '' }, t);
        expect(texto, `${metric}=${value}`).not.toMatch(/^\d+$/);
      }
    }
  });

  it('esLecturaDeEstado distingue suceso de magnitud', () => {
    expect(esLecturaDeEstado('contact')).toBe(true);
    expect(esLecturaDeEstado('smoke')).toBe(true);
    expect(esLecturaDeEstado('power')).toBe(false);
    expect(esLecturaDeEstado('temperature')).toBe(false);
  });
});

describe('METRIC_LABEL', () => {
  it('cubre TODAS las métricas del catálogo con una clave que existe', () => {
    // Exhaustividad real: una métrica nueva sin etiqueta pintaría la clave cruda.
    for (const metric of IOT_METRICS) {
      const key = METRIC_LABEL[metric];
      expect(key, `falta etiqueta de ${metric}`).toBeTruthy();
      // `t` cae a la clave si no existe en el catálogo; que devuelva algo distinto
      // demuestra que la traducción está puesta.
      expect(t(key), `${metric} sin traducir`).not.toBe(key);
    }
  });

  it('también traduce en inglés', () => {
    setLocale('en', { persist: false });
    try {
      expect(t(METRIC_LABEL.contact)).toBe('Opening');
      expect(describeReading({ metric: 'contact', value: 1, unit: '' }, t).value).toBe('Open');
    } finally {
      setLocale('es', { persist: false });
    }
  });
});
