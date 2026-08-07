import { describe, expect, it } from 'vitest';
import {
  dominioRegistrable,
  planDeAviso,
  type AparatoConocido,
  type ConsultaAtribuida,
} from '../../src/dns/new-destination.js';

/** Aviso de destino nuevo (US-253) — núcleo puro. */

describe('dominioRegistrable', () => {
  it('reduce el FQDN al dominio registrable', () => {
    // La propiedad que hace aceptable guardar esto para siempre: se sabe con
    // QUIÉN habla el aparato, no qué páginas visita.
    expect(dominioRegistrable('sdk.stats.example.com')).toBe('example.com');
    expect(dominioRegistrable('example.com')).toBe('example.com');
  });

  it('respeta los sufijos de dos niveles', () => {
    // Sin esto, `bbc.co.uk` se reduciría a `co.uk` y TODO el Reino Unido sería
    // un único destino: el aviso no volvería a saltar nunca.
    expect(dominioRegistrable('www.bbc.co.uk')).toBe('bbc.co.uk');
    expect(dominioRegistrable('tienda.com.es')).toBe('tienda.com.es');
  });

  it('normaliza mayúsculas y el punto final absoluto', () => {
    // Sin normalizar, `Example.com.` y `example.com` serían destinos distintos y
    // el mismo dominio avisaría dos veces.
    expect(dominioRegistrable('WWW.Example.COM.')).toBe('example.com');
  });

  it('descarta lo que no identifica un destino', () => {
    expect(dominioRegistrable('localhost')).toBeNull();
    expect(dominioRegistrable('')).toBeNull();
    expect(dominioRegistrable('   ')).toBeNull();
    // Una IP literal no le dice nada al usuario en un aviso.
    expect(dominioRegistrable('192.168.1.10')).toBeNull();
    expect(dominioRegistrable('fe80::1')).toBeNull();
  });

  it('la heurística cubre cualquier ccTLD, no solo los de una lista', () => {
    // El caso que destapó un razonamiento equivocado: con una lista fija de
    // sufijos, `com.pk` (ausente) colapsaba a `com.pk` y TODO Pakistán pasaba a
    // ser un único destino ya conocido — el aviso deja de saltar y no se nota.
    // La heurística (segundo nivel genérico + ccTLD de 2 letras) no depende de
    // que alguien acordara añadir el país a una lista.
    expect(dominioRegistrable('cdn.algo.com.pk')).toBe('algo.com.pk');
    expect(dominioRegistrable('a.b.gob.ar')).toBe('b.gob.ar');
  });

  it('no confunde un ccTLD normal con un sufijo compuesto', () => {
    // `.co` es Colombia: `example.co` es registrable tal cual. Si la heurística
    // se pasara de lista, lo recortaría a algo que no existe.
    expect(dominioRegistrable('www.example.co')).toBe('example.co');
    expect(dominioRegistrable('example.io')).toBe('example.io');
  });
});

describe('planDeAviso', () => {
  const HORA = 3600_000;
  const GRACIA = 24 * HORA;
  const AHORA = 1_000_000_000_000;

  const consulta = (mac: string, domain: string, at = AHORA): ConsultaAtribuida => ({
    mac,
    domain,
    at,
  });
  const conocido = (dominios: string[], observadoDesde: number | null): AparatoConocido => ({
    dominios: new Set(dominios),
    observadoDesde,
  });

  it('un destino ya conocido no se registra ni avisa', () => {
    const plan = planDeAviso(
      [consulta('aa', 'www.example.com')],
      new Map([['aa', conocido(['example.com'], AHORA - 10 * 24 * HORA)]]),
      GRACIA,
      AHORA,
    );
    expect(plan.aRegistrar).toEqual([]);
    expect(plan.aAvisar).toEqual([]);
  });

  it('un destino nuevo en un aparato ya observado se registra Y avisa', () => {
    const plan = planDeAviso(
      [consulta('aa', 'telemetria.fabricante.com')],
      new Map([['aa', conocido(['example.com'], AHORA - 10 * 24 * HORA)]]),
      GRACIA,
      AHORA,
    );
    expect(plan.aRegistrar).toEqual([
      { mac: 'aa', domain: 'fabricante.com', at: AHORA },
    ]);
    expect(plan.aAvisar).toEqual(plan.aRegistrar);
  });

  it('durante el aprendizaje REGISTRA pero NO avisa', () => {
    // El caso que hace usable la función: un aparato recién observado tiene
    // todos sus destinos «nuevos». Avisar de los 40 el primer día enseña al
    // usuario a ignorar el aviso, que es la forma de inutilizarlo.
    const plan = planDeAviso(
      [consulta('aa', 'uno.com'), consulta('aa', 'dos.com')],
      new Map([['aa', conocido([], AHORA - 2 * HORA)]]),
      GRACIA,
      AHORA,
    );
    expect(plan.aRegistrar).toHaveLength(2);
    expect(plan.aAvisar).toEqual([]);
  });

  it('un aparato visto por primera vez registra sin avisar', () => {
    // De que aparezca un aparato desconocido ya avisa `inventory.unknown_device`;
    // este aviso es para cambios de comportamiento de lo que YA estaba.
    const plan = planDeAviso([consulta('nueva', 'uno.com')], new Map(), GRACIA, AHORA);
    expect(plan.aRegistrar).toHaveLength(1);
    expect(plan.aAvisar).toEqual([]);
  });

  it('el mismo dominio dos veces en la misma tanda es UN destino', () => {
    // Sin deduplicar, una ráfaga de consultas al mismo sitio produciría un aviso
    // por cada una.
    const plan = planDeAviso(
      [consulta('aa', 'a.fabricante.com'), consulta('aa', 'b.fabricante.com')],
      new Map([['aa', conocido([], AHORA - 10 * 24 * HORA)]]),
      GRACIA,
      AHORA,
    );
    expect(plan.aRegistrar).toHaveLength(1);
    expect(plan.aAvisar).toHaveLength(1);
  });

  it('separa por aparato: el mismo dominio en otro aparato SÍ es nuevo', () => {
    // Conteos asimétricos a propósito (1 conocido, 1 nuevo): con dos y dos,
    // invertir la condición daría el mismo número.
    const plan = planDeAviso(
      [consulta('aa', 'example.com'), consulta('bb', 'example.com')],
      new Map([
        ['aa', conocido(['example.com'], AHORA - 10 * 24 * HORA)],
        ['bb', conocido(['otro.com'], AHORA - 10 * 24 * HORA)],
      ]),
      GRACIA,
      AHORA,
    );
    expect(plan.aRegistrar).toEqual([{ mac: 'bb', domain: 'example.com', at: AHORA }]);
  });

  it('justo al cumplirse la gracia ya avisa', () => {
    const plan = planDeAviso(
      [consulta('aa', 'uno.com')],
      new Map([['aa', conocido([], AHORA - GRACIA)]]),
      GRACIA,
      AHORA,
    );
    expect(plan.aAvisar).toHaveLength(1);
  });

  it('una consulta sin dominio utilizable se ignora entera', () => {
    const plan = planDeAviso(
      [consulta('aa', 'localhost'), consulta('aa', '10.0.0.1')],
      new Map([['aa', conocido([], AHORA - 10 * 24 * HORA)]]),
      GRACIA,
      AHORA,
    );
    expect(plan.aRegistrar).toEqual([]);
  });
});
