import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { ficheros, nombreDe } from './_fuentes';

/**
 * Gate: todo campo de contraseña declara `autoComplete`.
 *
 * Sin él, el gestor de contraseñas del navegador rellena la del administrador en
 * cualquier campo `type="password"` (la contraseña de la copia, el PIN de la alarma,
 * la clave del WiFi): el usuario guarda o sobrescribe sin darse cuenta lo que no era.
 *
 * Regla de valor:
 *  - la contraseña PROPIA de KrakenOS para entrar → `current-password`;
 *  - toda contraseña o clave que se ESTABLECE (propia nueva, de otro usuario, WiFi,
 *    broker, clave de aparato, PIN de alarma) → `new-password`;
 *  - un secreto que se teclea para COMPROBAR algo que no es la cuenta (contraseña de
 *    una copia al restaurar, PIN para desarmar) → `off`.
 *
 * Por AST: un elemento JSX cuyo atributo `type` es el literal `'password'` o una
 * expresión que lo contiene (`type={ver ? 'text' : 'password'}`), sin atributo
 * `autoComplete`. Los comentarios no cuentan.
 */

export interface Campo {
  linea: number;
  conAutocompletar: boolean;
}

function contieneLiteralPassword(nodo: ts.Node): boolean {
  if (ts.isStringLiteralLike(nodo)) return nodo.text === 'password';
  return (
    ts.forEachChild(nodo, (hijo) => (contieneLiteralPassword(hijo) ? true : undefined)) === true
  );
}

export function camposDeContrasena(nombre: string, codigo: string): Campo[] {
  const sf = ts.createSourceFile(nombre, codigo, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const salida: Campo[] = [];
  const visitar = (nodo: ts.Node): void => {
    if (ts.isJsxOpeningElement(nodo) || ts.isJsxSelfClosingElement(nodo)) {
      const atributos = nodo.attributes.properties.filter(ts.isJsxAttribute);
      const porNombre = (n: string) => atributos.find((a) => a.name.getText(sf) === n);
      const tipo = porNombre('type');
      if (tipo?.initializer && contieneLiteralPassword(tipo.initializer)) {
        salida.push({
          linea: sf.getLineAndCharacterOfPosition(nodo.getStart()).line + 1,
          conAutocompletar: porNombre('autoComplete') !== undefined,
        });
      }
    }
    ts.forEachChild(nodo, visitar);
  };
  // Falla cerrado: un fuente que no parsea daría una lista vacía y el gate pasaría en falso.
  const diagnosticos = (sf as unknown as { parseDiagnostics?: unknown[] }).parseDiagnostics;
  if (diagnosticos && diagnosticos.length > 0) {
    throw new Error(`No se pudo analizar ${nombre}: ${diagnosticos.length} error(es) de sintaxis`);
  }
  visitar(sf);
  return salida;
}

export function camposSinAutocompletar(codigo: string): number {
  return camposDeContrasena('x.tsx', codigo).filter((c) => !c.conAutocompletar).length;
}

describe('autocompletar-contrasenas', () => {
  it('detecta un campo de contraseña sin autoComplete', () => {
    expect(camposSinAutocompletar('const a = <Input type="password" />;')).toBe(1);
    expect(camposSinAutocompletar("const a = <input type={ver ? 'text' : 'password'} />;")).toBe(1);
    expect(camposSinAutocompletar('const a = <Input\n  type="password"\n  value={x}\n/>;')).toBe(1);
    expect(camposSinAutocompletar('const a = <Input type="password" autoComplete="off" />;')).toBe(
      0,
    );
    expect(
      camposSinAutocompletar(
        "const a = <Input type={secret ? 'password' : 'text'} autoComplete={secret ? 'new-password' : undefined} />;",
      ),
    ).toBe(0);
    expect(camposSinAutocompletar('const a = <Input type="text" />;')).toBe(0);
    expect(camposSinAutocompletar('// <Input type="password" />\nconst a = 1;')).toBe(0);
    expect(camposSinAutocompletar('/* <Input type="password" /> */\nconst a = 1;')).toBe(0);
  });

  it('falla cerrado ante un fuente que no se puede analizar', () => {
    expect(() => camposSinAutocompletar('const a = <Input type="password"')).toThrow(/x\.tsx/);
  });

  const todos = ficheros()
    .filter((ruta) => ruta.endsWith('.tsx'))
    .flatMap((ruta) =>
      camposDeContrasena(nombreDe(ruta), readFileSync(ruta, 'utf8')).map((c) => ({
        ...c,
        nombre: nombreDe(ruta),
      })),
    );

  it('encuentra los campos de contraseña', () => {
    // Hoy 20: 18 literales + LoginPage + IntegrationWizard.
    expect(todos.length).toBeGreaterThanOrEqual(18);
  });

  it('todo campo de contraseña declara autoComplete', () => {
    const sin = todos.filter((c) => !c.conAutocompletar).map((c) => `${c.nombre}:${c.linea}`);
    expect(
      sin,
      'Campos de contraseña sin autoComplete (current-password = la propia para entrar; ' +
        'new-password = lo que se establece; off = secreto que solo comprueba algo que no es la cuenta):\n' +
        sin.join('\n'),
    ).toEqual([]);
  });
});
