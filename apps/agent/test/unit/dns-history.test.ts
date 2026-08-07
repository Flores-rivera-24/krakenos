import type { DnsQuery } from '@krakenos/types';
import { describe, expect, it } from 'vitest';
import {
  MARCA_INICIAL,
  aparatosSinConsultas,
  firmaDeConsulta,
  macDelCliente,
  seleccionarNuevas,
} from '../../src/dns/history.js';

/**
 * US-252. El núcleo puro del histórico DNS. Los dos errores que se prueban aquí
 * —duplicar el histórico y atribuirlo al aparato equivocado— **no fallan
 * ruidosamente**: uno infla los números y el otro acusa a otra persona, y los dos
 * se ven igual que el comportamiento correcto si no se mira.
 */

const q = (ms: number, domain: string, client = '192.168.1.10', blocked = false): DnsQuery => ({
  timestamp: new Date(ms).toISOString(),
  domain,
  client,
  blocked,
});

describe('seleccionarNuevas (US-252)', () => {
  it('con la marca inicial entra todo, en orden cronológico', () => {
    const { nuevas, marca } = seleccionarNuevas([q(3000, 'c.com'), q(1000, 'a.com'), q(2000, 'b.com')], MARCA_INICIAL, 100);
    expect(nuevas.map((n) => n.domain)).toEqual(['a.com', 'b.com', 'c.com']);
    expect(marca.ultimoMs).toBe(3000);
  });

  it('no vuelve a ingerir lo ya visto en el barrido siguiente', () => {
    const primera = seleccionarNuevas([q(1000, 'a.com'), q(2000, 'b.com')], MARCA_INICIAL, 100);
    // El resolver devuelve una ventana solapada: las dos de antes y una nueva.
    const segunda = seleccionarNuevas(
      [q(1000, 'a.com'), q(2000, 'b.com'), q(3000, 'c.com')],
      primera.marca,
      100,
    );
    expect(segunda.nuevas.map((n) => n.domain)).toEqual(['c.com']);
  });

  it('⚠️ dos consultas del MISMO milisegundo no se pierden ni se duplican', () => {
    // Un `A` y un `AAAA` del mismo aparato comparten instante. Con una marca que
    // solo guardase el número, o se pierde una (`>`) o se duplican las dos (`>=`).
    const primera = seleccionarNuevas([q(1000, 'a.com'), q(1000, 'b.com')], MARCA_INICIAL, 100);
    expect(primera.nuevas).toHaveLength(2);

    const segunda = seleccionarNuevas([q(1000, 'a.com'), q(1000, 'b.com')], primera.marca, 100);
    expect(segunda.nuevas).toHaveLength(0);
  });

  it('una consulta NUEVA en un milisegundo ya visto sí entra', () => {
    const primera = seleccionarNuevas([q(1000, 'a.com')], MARCA_INICIAL, 100);
    const segunda = seleccionarNuevas([q(1000, 'a.com'), q(1000, 'b.com')], primera.marca, 100);
    expect(segunda.nuevas.map((n) => n.domain)).toEqual(['b.com']);
    // Y la marca conserva las dos firmas, o la primera volvería a entrar después.
    const tercera = seleccionarNuevas([q(1000, 'a.com'), q(1000, 'b.com')], segunda.marca, 100);
    expect(tercera.nuevas).toHaveLength(0);
  });

  it('el tope acota la tanda y lo que no entró SIGUE siendo nuevo', () => {
    const lote = [q(1000, 'a.com'), q(2000, 'b.com'), q(3000, 'c.com'), q(4000, 'd.com')];
    const primera = seleccionarNuevas(lote, MARCA_INICIAL, 2);
    expect(primera.nuevas.map((n) => n.domain)).toEqual(['a.com', 'b.com']);

    // La marca avanzó a la última INGERIDA, no al máximo visto: si avanzara a 4000,
    // c.com y d.com se perderían para siempre y sin un solo error.
    expect(primera.marca.ultimoMs).toBe(2000);
    const segunda = seleccionarNuevas(lote, primera.marca, 2);
    expect(segunda.nuevas.map((n) => n.domain)).toEqual(['c.com', 'd.com']);
  });

  it('sin consultas nuevas la marca no se mueve', () => {
    const primera = seleccionarNuevas([q(1000, 'a.com')], MARCA_INICIAL, 100);
    const segunda = seleccionarNuevas([], primera.marca, 100);
    expect(segunda.nuevas).toHaveLength(0);
    expect(segunda.marca).toBe(primera.marca);
  });

  it('descarta lo que no tiene instante parseable en vez de ingerirlo con fecha inventada', () => {
    const roto = { ...q(1000, 'a.com'), timestamp: 'no-es-una-fecha' };
    const { nuevas } = seleccionarNuevas([roto, q(2000, 'b.com')], MARCA_INICIAL, 100);
    expect(nuevas.map((n) => n.domain)).toEqual(['b.com']);
  });

  it('la firma distingue cliente, dominio y bloqueo', () => {
    expect(firmaDeConsulta(q(1, 'a.com', '10.0.0.1'))).not.toBe(
      firmaDeConsulta(q(1, 'a.com', '10.0.0.2')),
    );
    expect(firmaDeConsulta(q(1, 'a.com', '10.0.0.1', false))).not.toBe(
      firmaDeConsulta(q(1, 'a.com', '10.0.0.1', true)),
    );
  });
});

describe('macDelCliente (US-252)', () => {
  const mapa = new Map([
    ['192.168.1.10', 'aa:bb:cc:dd:ee:01'],
    ['192.168.1.11', 'aa:bb:cc:dd:ee:02'],
  ]);

  it('resuelve la IP al aparato del inventario', () => {
    expect(macDelCliente('192.168.1.10', mapa)).toBe('aa:bb:cc:dd:ee:01');
  });

  it('⚠️ una IP que no consta devuelve null, no el aparato «más parecido»', () => {
    // Adivinar por rango o por proximidad es como se acaba atribuyendo la
    // navegación de alguien al vecino de subred.
    expect(macDelCliente('192.168.1.99', mapa)).toBeNull();
    expect(macDelCliente('10.0.0.1', mapa)).toBeNull();
  });

  it('tolera espacios alrededor de la IP', () => {
    expect(macDelCliente(' 192.168.1.11 ', mapa)).toBe('aa:bb:cc:dd:ee:02');
  });
});

describe('aparatosSinConsultas (US-252)', () => {
  it('cuenta los que no han hecho ni una consulta', () => {
    const enLinea = ['mac-a', 'mac-b', 'mac-c'];
    // Asimétrico a propósito (1 de 3): con 2 y 2, invertir la condición daría igual.
    expect(aparatosSinConsultas(enLinea, new Set(['mac-a', 'mac-b']))).toBe(1);
  });

  it('sin ninguna consulta, todos están callados', () => {
    expect(aparatosSinConsultas(['mac-a', 'mac-b'], new Set())).toBe(2);
  });

  it('un aparato con consultas que ya no está en línea no cuenta como callado', () => {
    expect(aparatosSinConsultas([], new Set(['mac-a']))).toBe(0);
  });
});
