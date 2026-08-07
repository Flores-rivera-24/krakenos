import { describe, expect, it } from 'vitest';
import {
  construirUrl,
  esUbicacionValida,
  parsearLecturas,
  ubicacionEnviada,
} from '../../src/weather/open-meteo.js';

/** Núcleo puro del proveedor del tiempo (US-254). */
describe('ubicacionEnviada', () => {
  it('en modo exacto devuelve la coordenada tal cual', () => {
    const loc = { lat: 41.38879, lon: 2.15899 };
    expect(ubicacionEnviada(loc, 'exact')).toEqual(loc);
  });

  it('redondea a 0,1° (~11 km) en modo protegido', () => {
    // 41,38879 → 41,4 y 2,15899 → 2,2: sigue siendo la misma ciudad (el tiempo
    // no cambia), pero ya no señala el portal.
    expect(ubicacionEnviada({ lat: 41.38879, lon: 2.15899 }, 'rounded')).toEqual({
      lat: 41.4,
      lon: 2.2,
    });
  });

  it('CUANTIZA a la rejilla en vez de truncar, también con coordenadas negativas', () => {
    // Truncar conservaría el signo del error y apuntaría siempre al mismo lado
    // de la casa, que es un sesgo explotable. -3,74 debe subir a -3,7.
    expect(ubicacionEnviada({ lat: 40.46, lon: -3.74 }, 'rounded')).toEqual({
      lat: 40.5,
      lon: -3.7,
    });
  });

  it('no arrastra el error binario del redondeo', () => {
    // `Math.round(41.38 / 0.1) * 0.1` da 41.400000000000006: ese número viajaría
    // en la URL y delataría que detrás hay una coordenada más precisa.
    const { lat } = ubicacionEnviada({ lat: 41.38879, lon: 2.15899 }, 'rounded');
    expect(String(lat)).toBe('41.4');
    expect(construirUrl({ lat, lon: 2.2 })).toContain('latitude=41.4');
  });

  it('el redondeo NO es identidad: cambia la coordenada que sale', () => {
    // Sin esta aserción, una implementación que devolviera `loc` intacta pasaría
    // los casos de arriba que ya caen en la rejilla.
    const exacta = ubicacionEnviada({ lat: 41.38879, lon: 2.15899 }, 'exact');
    const protegida = ubicacionEnviada({ lat: 41.38879, lon: 2.15899 }, 'rounded');
    expect(protegida).not.toEqual(exacta);
  });
});

describe('esUbicacionValida', () => {
  it('acepta una ubicación real', () => {
    expect(esUbicacionValida({ lat: 41.4, lon: 2.2 })).toBe(true);
  });

  it('rechaza NaN y fuera de rango', () => {
    expect(esUbicacionValida({ lat: Number.NaN, lon: 2 })).toBe(false);
    expect(esUbicacionValida({ lat: 91, lon: 0 })).toBe(false);
    expect(esUbicacionValida({ lat: 0, lon: -181 })).toBe(false);
  });
});

describe('construirUrl', () => {
  it('apunta al proveedor declarado y pide solo las tres magnitudes del contrato', () => {
    const url = construirUrl({ lat: 41.4, lon: 2.2 });
    expect(url.startsWith('https://api.open-meteo.com/v1/forecast')).toBe(true);
    expect(url).toContain('latitude=41.4');
    expect(url).toContain('longitude=2.2');
    const current = new URL(url).searchParams.get('current');
    expect(current).toBe('temperature_2m,precipitation,wind_speed_10m');
  });
});

describe('parsearLecturas', () => {
  it('extrae las tres magnitudes', () => {
    expect(
      parsearLecturas({
        current: { temperature_2m: 4.2, precipitation: 0, wind_speed_10m: 11.5 },
      }),
    ).toEqual([
      { metric: 'temperature', value: 4.2 },
      { metric: 'precipitation', value: 0 },
      { metric: 'wind', value: 11.5 },
    ]);
  });

  it('conserva el 0 como medida real (no lo confunde con ausente)', () => {
    // «No llueve» es un dato: si se cayera, una regla «si deja de llover» nunca
    // vería el flanco de vuelta.
    const lecturas = parsearLecturas({ current: { precipitation: 0 } });
    expect(lecturas).toEqual([{ metric: 'precipitation', value: 0 }]);
  });

  it('OMITE lo que no es un número finito en vez de colarlo como NaN', () => {
    // Un NaN compara `false` contra cualquier umbral: dejaría la regla muda sin
    // un solo error, que es el peor fallo posible aquí.
    const lecturas = parsearLecturas({
      current: { temperature_2m: 'frío', precipitation: null, wind_speed_10m: 11.5 },
    });
    expect(lecturas).toEqual([{ metric: 'wind', value: 11.5 }]);
  });

  it('aguanta basura sin lanzar (es entrada de red)', () => {
    expect(parsearLecturas(null)).toEqual([]);
    expect(parsearLecturas('nope')).toEqual([]);
    expect(parsearLecturas({})).toEqual([]);
    expect(parsearLecturas({ current: 42 })).toEqual([]);
  });
});
