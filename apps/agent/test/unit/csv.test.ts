import { describe, expect, it } from 'vitest';
import { toCsv } from '../../src/modules/reports/csv.js';

describe('csv (US-109)', () => {
  it('serializa filas simples con CRLF', () => {
    expect(toCsv(['a', 'b'], [[1, 'x'], [2, 'y']])).toBe('a,b\r\n1,x\r\n2,y\r\n');
  });

  it('entrecomilla comas, comillas y saltos de línea (RFC 4180)', () => {
    expect(toCsv(['h'], [['a,b'], ['dijo "hola"'], ['linea1\nlinea2']])).toBe(
      'h\r\n"a,b"\r\n"dijo ""hola"""\r\n"linea1\nlinea2"\r\n',
    );
  });

  it('trata null/undefined como campo vacío', () => {
    expect(toCsv(['a', 'b'], [[null, undefined]])).toBe('a,b\r\n,\r\n');
  });
});
