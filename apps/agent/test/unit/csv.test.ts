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

  it('neutraliza la inyección de fórmulas (=, +, -, @, TAB, CR) anteponiendo apóstrofo', () => {
    // Un hostname hostil anunciado en la red no debe ejecutarse como fórmula al
    // abrir el CSV en Excel/LibreOffice.
    // El apóstrofo se antepone y, como el valor lleva comillas, se aplica el
    // entrecomillado RFC 4180 (comillas internas duplicadas).
    expect(toCsv(['h'], [['=HYPERLINK("http://evil")']])).toBe(
      'h\r\n"\'=HYPERLINK(""http://evil"")"\r\n',
    );
    // Cada prefijo peligroso recibe el apóstrofo (y luego el entrecomillado RFC 4180
    // si hace falta). Casos simples sin comillas internas:
    expect(toCsv(['h'], [['+1']])).toBe("h\r\n'+1\r\n");
    expect(toCsv(['h'], [['-2+3']])).toBe("h\r\n'-2+3\r\n");
    expect(toCsv(['h'], [['@cmd']])).toBe("h\r\n'@cmd\r\n");
    expect(toCsv(['h'], [['\tTAB']])).toBe("h\r\n'\tTAB\r\n");
  });

  it('no altera valores que no empiezan por un prefijo de fórmula', () => {
    expect(toCsv(['h'], [['normal'], ['a=b'], ['10']])).toBe('h\r\nnormal\r\na=b\r\n10\r\n');
  });
});
