import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { ficheros, nombreDe } from './_fuentes';

/**
 * Gate: ningún grupo de botones-selector (`<button aria-pressed>`) escrito a mano fuera de
 * `components/ui/`.
 *
 * Los grupos se escriben con `SegmentedControl`, `ToggleChip`/`ToggleChipGroup` o
 * `DayPicker`, que fijan altura táctil, foco y color de pulsado. Uno a mano vuelve a repartir
 * esos estilos por la web, y se desvían en silencio.
 *
 * Por AST: cuenta elementos JSX intrínsecos `button` con atributo `aria-pressed`. Los
 * componentes (`<ToggleChip pressed />`), otros elementos (`<g aria-pressed>`) y los
 * comentarios no cuentan.
 */

/** Ficheros con un `<button aria-pressed>` permitido. Cada entrada exige su porqué. */
const EXCEPCIONES: Record<string, string> = {
  'components/coverage/CoverageToolbar.tsx':
    'herramientas del plano: botones de icono con nombre propio, fuera del alcance de la tanda 6',
  'components/dashboard/widgets/HomeModeWidget.tsx':
    'tarjetas de opción con descripción: no son segmentos',
  'components/settings/UiModeCard.tsx': 'tarjetas de opción con descripción: no son segmentos',
  'components/settings/LanguageCard.tsx': 'tarjetas de opción con descripción: no son segmentos',
  'pages/RoomsPage.tsx': 'cuadrícula de iconos',
  'pages/ScenesPage.tsx': 'cuadrícula de iconos',
};

/** Líneas (1-based) de cada JSX intrínseco `button` con `aria-pressed`. */
export function botonesConPressed(nombre: string, codigo: string): number[] {
  const sf = ts.createSourceFile(nombre, codigo, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  // Falla cerrado: un fuente que no parsea daría una lista vacía y el gate pasaría en falso.
  const diagnosticos = (sf as unknown as { parseDiagnostics?: unknown[] }).parseDiagnostics;
  if (diagnosticos && diagnosticos.length > 0) {
    throw new Error(`No se pudo analizar ${nombre}: ${diagnosticos.length} error(es) de sintaxis`);
  }
  const salida: number[] = [];
  const visitar = (nodo: ts.Node): void => {
    if (
      (ts.isJsxOpeningElement(nodo) || ts.isJsxSelfClosingElement(nodo)) &&
      nodo.tagName.getText(sf) === 'button' &&
      nodo.attributes.properties.some(
        (p) => ts.isJsxAttribute(p) && p.name.getText(sf) === 'aria-pressed',
      )
    ) {
      salida.push(sf.getLineAndCharacterOfPosition(nodo.getStart()).line + 1);
    }
    ts.forEachChild(nodo, visitar);
  };
  visitar(sf);
  return salida;
}

describe('grupos-a-mano', () => {
  it('control positivo: cuenta <button aria-pressed> y no componentes, <g> ni comentarios', () => {
    expect(botonesConPressed('x.tsx', '[<button aria-pressed={x} />]')).toEqual([1]);
    expect(
      botonesConPressed('x.tsx', '[\n<button type="button" aria-pressed={x}>a</button>]'),
    ).toEqual([2]);
    expect(botonesConPressed('x.tsx', '[<ToggleChip pressed />, <g aria-pressed />]')).toEqual([]);
    expect(
      botonesConPressed('x.tsx', '[<button type="button" />,\n// <button aria-pressed>\n]'),
    ).toEqual([]);
  });

  it('falla cerrado con un fuente roto', () => {
    expect(() => botonesConPressed('x.tsx', 'const a = <button aria-pressed')).toThrow(/x\.tsx/);
  });

  const recorridos = ficheros().filter((ruta) => ruta.endsWith('.tsx'));
  const hallazgos = recorridos.flatMap((ruta) => {
    const nombre = nombreDe(ruta);
    if (nombre.startsWith('components/ui/')) return [];
    return botonesConPressed(nombre, readFileSync(ruta, 'utf8')).map((linea) => ({
      nombre,
      linea,
    }));
  });

  it('el recorrido ve el árbol de fuentes', () => {
    expect(recorridos.length).toBeGreaterThan(100);
  });

  it('ningún botón-selector a mano fuera de components/ui/', () => {
    const fuera = hallazgos
      .filter((h) => !(h.nombre in EXCEPCIONES))
      .map((h) => `${h.nombre}:${h.linea}`);
    expect(
      fuera,
      'Usa SegmentedControl, ToggleChip/ToggleChipGroup o DayPicker (components/ui/) en vez de un <button aria-pressed> a mano:\n' +
        fuera.join('\n'),
    ).toEqual([]);
  });

  it('la allowlist no tiene entradas obsoletas', () => {
    const conBoton = new Set(hallazgos.map((h) => h.nombre));
    const obsoletas = Object.keys(EXCEPCIONES).filter((n) => !conBoton.has(n));
    expect(obsoletas).toEqual([]);
  });
});
