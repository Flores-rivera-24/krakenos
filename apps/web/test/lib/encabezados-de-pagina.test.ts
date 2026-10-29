import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Cada página tiene **un título de primer nivel** (US-266).
 *
 * De las 21 páginas, 18 titulaban con un `<h2>` colgando de nada y `/inventory`
 * no tenía **ningún** encabezado. Para quien navega con lector de pantalla eso
 * no es un detalle de marcado: el atajo «ir al encabezado principal» no lleva a
 * ninguna parte y no hay forma de saber en qué sección se está sin releer el
 * menú entero. Y no lo cazaba nadie, porque un `<h2>` con la clase del tamaño
 * correcto se **ve** exactamente igual que un `<h1>`.
 *
 * Este gate es **estático** a propósito: mira el fuente, así que cubre las
 * páginas y caza la siguiente que se añada, sin montar cada una con sus datos.
 *
 * ⚠️ Y por eso **no** comprueba el ORDEN de los encabezados: en el fuente, un
 * subcomponente declarado antes del componente de página pone su `<h3>` primero
 * sin que en pantalla salga antes de nada (pasa en `PeoplePage`). El orden y el
 * «exactamente uno» son propiedades del documento renderizado, y las asevera la
 * suite de navegador: `e2e/stacks` cuenta los `<h1>` de las páginas del admin
 * y axe aplica `heading-order` en `e2e/tests/a11y.spec.ts`. Los dos juntos,
 * ninguno solo.
 *
 * El análisis del `<h1>` va por el AST de TypeScript (no por regex): una regex
 * no ve `className={cn(…)}`, ni plantillas, ni un `>` dentro de otro atributo.
 */

// Pantallas de entrada: tienen su propia composición de marca (logo, título
// centrado, tipografía de bienvenida), así que no siguen el estilo de título de la app.
const PANTALLAS_DE_ENTRADA = ['LoginPage', 'SetupPage', 'WelcomePage', 'InvitePage'];

const CLASES_REQUERIDAS = ['text-kr-xl', 'font-semibold', 'text-kr-primary'];
const CLASES_PROHIBIDAS = ['text-xl', 'text-2xl', 'text-kr-2xl'];

// Igual que `tailwind-palette.test.ts`: vitest corre con el cwd del paquete.
const DIR_PAGINAS = join(process.cwd(), 'src', 'pages');

const paginas = readdirSync(DIR_PAGINAS)
  .filter((f) => f.endsWith('Page.tsx'))
  .map((f) => ({ nombre: f, fuente: readFileSync(join(DIR_PAGINAS, f), 'utf8') }));

/**
 * Problemas de título de UN fuente: `<h1>` sin `className`, con `className` que no
 * tiene las tres clases o que conserva una de tamaño antigua. Si la expresión de
 * `className` no es literal (`cn(…)`, plantilla), se mira su texto: las clases
 * aparecen como tokens igual que en un literal.
 */
export function problemasDeTitulo(nombre: string, fuente: string): string[] {
  const sf = ts.createSourceFile(nombre, fuente, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const problemas: string[] = [];
  let h1s = 0;

  const visitar = (nodo: ts.Node): void => {
    const apertura =
      ts.isJsxOpeningElement(nodo) || ts.isJsxSelfClosingElement(nodo) ? nodo : undefined;
    if (apertura && apertura.tagName.getText(sf) === 'h1') {
      h1s++;
      const atributos = apertura.attributes.properties;
      const className = atributos.find(
        (a): a is ts.JsxAttribute => ts.isJsxAttribute(a) && a.name.getText(sf) === 'className',
      );
      if (atributos.some((a) => ts.isJsxSpreadAttribute(a))) {
        // Un spread puede traer la clase: no se puede comprobar, así que falla cerrado.
        problemas.push(`${nombre}: <h1> con {...spread}, no se puede comprobar la clase`);
      } else if (!className || !className.initializer) {
        problemas.push(`${nombre}: <h1> sin className`);
      } else {
        const init = className.initializer;
        const texto = ts.isStringLiteral(init)
          ? init.text
          : ts.isJsxExpression(init) && init.expression
            ? init.expression.getText(sf)
            : '';
        const tokens = new Set(texto.split(/[^A-Za-z0-9_\-[\]/.:%]+/).filter(Boolean));
        const faltan = CLASES_REQUERIDAS.filter((c) => !tokens.has(c));
        const sobran = CLASES_PROHIBIDAS.filter((c) => tokens.has(c));
        if (faltan.length > 0 || sobran.length > 0) {
          problemas.push(
            `${nombre}: <h1> faltan [${faltan.join(' ')}] sobran [${sobran.join(' ')}]`,
          );
        }
      }
    }
    ts.forEachChild(nodo, visitar);
  };
  visitar(sf);

  if (h1s === 0) problemas.push(`${nombre}: sin <h1>`);
  return problemas;
}

const paginasComprobadas = paginas.filter(
  (p) => !PANTALLAS_DE_ENTRADA.includes(p.nombre.replace(/\.tsx$/, '')),
);

describe('jerarquía de encabezados de las páginas (US-266)', () => {
  it('encuentra las páginas: si el glob se rompe, este gate no pasa en vacío', () => {
    // Sin este guard, un cambio de ruta dejaría la lista a cero y las
    // aserciones de abajo pasarían sin haber mirado un solo fichero.
    expect(paginas.length).toBeGreaterThan(15);
  });

  it.each(paginas.map((p) => p.nombre))('«%s» declara un <h1>', (nombre) => {
    const pagina = paginas.find((p) => p.nombre === nombre)!;
    expect(pagina.fuente).toMatch(/<h1[\s>]/);
  });

  it('ninguna página vuelve a titularse con el <h2> del tamaño de un título', () => {
    // La forma exacta que tenían las 18: se ve igual que un `<h1>` y por eso
    // sobrevivió a todas las revisiones visuales.
    const reincidentes = paginas
      .filter((p) =>
        /<h2\s+className="(?:text-xl font-semibold|text-kr-xl font-semibold)/.test(p.fuente),
      )
      .map((p) => p.nombre);
    expect(reincidentes).toEqual([]);
  });

  it('las páginas de la app titulan con la misma clase', () => {
    // Falla cerrado por sí solo: si el glob o el filtro de entradas se rompen,
    // se comprueban menos páginas y el gate no puede pasar en silencio.
    expect(paginasComprobadas.length).toBeGreaterThan(15);

    const incumplen = paginasComprobadas.flatMap((p) => problemasDeTitulo(p.nombre, p.fuente));
    expect(incumplen).toEqual([]);
  });

  it('PANTALLAS_DE_ENTRADA no tiene entradas obsoletas', () => {
    // Una entrada que ya no existe es una exención muerta: falla para que se retire.
    const obsoletas = PANTALLAS_DE_ENTRADA.filter(
      (nombre) => !existsSync(join(DIR_PAGINAS, `${nombre}.tsx`)),
    );
    expect(obsoletas).toEqual([]);
  });

  describe('control positivo del análisis (fuentes sintéticos)', () => {
    it('un <h1> con className={cn(…)} que lleva text-xl cuenta como fallo', () => {
      const fuente = `export default function P() {
        return <h1 className={cn('text-xl', 'font-semibold text-kr-primary')}>x</h1>;
      }`;
      const problemas = problemasDeTitulo('Sintetico.tsx', fuente);
      expect(problemas.length).toBeGreaterThan(0);
      expect(problemas[0]).toContain('sobran [text-xl]');
    });

    it('un <h1> con un > antes de className y las tres clases pasa', () => {
      const fuente = `export default function P() {
        return <h1 onClick={() => x} className="text-kr-xl font-semibold text-kr-primary">x</h1>;
      }`;
      expect(problemasDeTitulo('Sintetico.tsx', fuente)).toEqual([]);
    });

    it('un <h1> sin className cuenta como fallo', () => {
      const fuente = `export default function P() { return <h1>x</h1>; }`;
      expect(problemasDeTitulo('Sintetico.tsx', fuente)).toEqual([
        'Sintetico.tsx: <h1> sin className',
      ]);
    });

    it('una página sin ningún <h1> cuenta como fallo', () => {
      const fuente = `export default function P() { return <h2 className="text-kr-xl font-semibold text-kr-primary">x</h2>; }`;
      expect(problemasDeTitulo('Sintetico.tsx', fuente)).toEqual(['Sintetico.tsx: sin <h1>']);
    });
  });
});
