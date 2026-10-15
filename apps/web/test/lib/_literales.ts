/**
 * Utilidades de lectura de código para los gates que buscan copy a pelo.
 *
 * Existen porque una expresión regular no sabe dónde acaba una llamada o una
 * expresión entre llaves: `filaAbrible(() => f(x), \`Ver ${n}\`)` o
 * `aria-label={a ? 'x' : t('y')}` se leen bien con un contador de paréntesis y
 * mal con `[^)]*`. Trabajan sobre código **ya sin comentarios**
 * (`_fuentes.ts::sinComentariosConLineas`).
 */

/**
 * Dado `codigo` y la posición de un delimitador de apertura (`(` o `{`), devuelve
 * la posición de su cierre, ignorando lo que haya dentro de cadenas y plantillas.
 * `-1` si no cierra (código roto: el gate falla cerrado y no inventa un hallazgo).
 */
export function cierreDe(codigo: string, abre: number): number {
  const PARES: Record<string, string> = { '(': ')', '{': '}', '[': ']' };
  const pila: string[] = [PARES[codigo[abre]!]!];
  let i = abre + 1;
  while (i < codigo.length && pila.length > 0) {
    const c = codigo[i]!;
    if (c === "'" || c === '"') {
      i = finDeCadena(codigo, i);
      continue;
    }
    if (c === '`') {
      i = finDePlantilla(codigo, i);
      continue;
    }
    if (c in PARES) pila.push(PARES[c]!);
    else if (c === pila[pila.length - 1]) pila.pop();
    i++;
  }
  return pila.length === 0 ? i - 1 : -1;
}

/** Índice justo DESPUÉS de la cadena `'…'`/`"…"` que empieza en `inicio`. */
function finDeCadena(codigo: string, inicio: number): number {
  const comilla = codigo[inicio]!;
  let i = inicio + 1;
  while (i < codigo.length && codigo[i] !== comilla && codigo[i] !== '\n') {
    if (codigo[i] === '\\') i++;
    i++;
  }
  return i + 1;
}

/** Índice justo DESPUÉS de la plantilla que empieza en `inicio`, con sus `${…}` anidados. */
function finDePlantilla(codigo: string, inicio: number): number {
  let i = inicio + 1;
  while (i < codigo.length && codigo[i] !== '`') {
    if (codigo[i] === '\\') {
      i += 2;
      continue;
    }
    if (codigo[i] === '$' && codigo[i + 1] === '{') {
      const cierre = cierreDe(codigo, i + 1);
      if (cierre === -1) return codigo.length;
      i = cierre + 1;
      continue;
    }
    i++;
  }
  return i + 1;
}

/** Parte `texto` por las comas de PRIMER nivel (las de dentro de ()/{}/[] o cadenas no cuentan). */
export function argumentosDeNivelUno(texto: string): string[] {
  const salida: string[] = [];
  let desde = 0;
  let i = 0;
  while (i < texto.length) {
    const c = texto[i]!;
    if (c === "'" || c === '"') {
      i = finDeCadena(texto, i);
      continue;
    }
    if (c === '`') {
      i = finDePlantilla(texto, i);
      continue;
    }
    if (c === '(' || c === '{' || c === '[') {
      const cierre = cierreDe(texto, i);
      if (cierre === -1) break;
      i = cierre + 1;
      continue;
    }
    if (c === ',') {
      salida.push(texto.slice(desde, i));
      desde = i + 1;
    }
    i++;
  }
  salida.push(texto.slice(desde));
  return salida.map((a) => a.trim()).filter((a) => a !== '');
}

/**
 * Los argumentos de cada llamada a `nombre(...)` con su línea. No cuenta la
 * declaración (`function nombre(`) ni un `obj.nombre(` de otro objeto.
 */
export function llamadasA(codigo: string, nombre: string): { args: string[]; linea: number }[] {
  const re = new RegExp(String.raw`(?<![\w$])(?<![\w$]\.)(?<!function\s)${nombre}\s*\(`, 'g');
  const salida: { args: string[]; linea: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(codigo)) !== null) {
    const abre = m.index + m[0].length - 1;
    const cierre = cierreDe(codigo, abre);
    if (cierre === -1) continue;
    salida.push({
      args: argumentosDeNivelUno(codigo.slice(abre + 1, cierre)),
      linea: codigo.slice(0, m.index).split('\n').length,
    });
  }
  return salida;
}

/** Quita de `expr` las llamadas `t(...)`: su primer argumento es una CLAVE, no copy. */
export function sinLlamadasAT(expr: string): string {
  const re = /(?<![\w.$])t\s*\(/g;
  let salida = '';
  let desde = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(expr)) !== null) {
    if (m.index < desde) continue;
    const abre = m.index + m[0].length - 1;
    const cierre = cierreDe(expr, abre);
    if (cierre === -1) break;
    salida += expr.slice(desde, m.index) + '""';
    desde = cierre + 1;
    re.lastIndex = desde;
  }
  return salida + expr.slice(desde);
}

/**
 * Cadenas y plantillas con TEXTO (alguna letra fuera de los `${…}`) en una
 * expresión, ignorando las llamadas a `t(...)`. Es lo que un lector de pantalla
 * o la vista acabarían diciendo en español aunque la interfaz esté en inglés.
 */
export function literalesConTexto(expr: string): string[] {
  const limpia = sinLlamadasAT(expr);
  const salida: string[] = [];
  let i = 0;
  while (i < limpia.length) {
    const c = limpia[i]!;
    if (c === "'" || c === '"') {
      const fin = finDeCadena(limpia, i);
      // `rest['aria-label']` es un ÍNDICE, no copy.
      const esIndice = /\[\s*$/.test(limpia.slice(0, i)) && /^\s*\]/.test(limpia.slice(fin));
      if (!esIndice) salida.push(limpia.slice(i + 1, fin - 1));
      i = fin;
    } else if (c === '`') {
      const fin = finDePlantilla(limpia, i);
      salida.push(limpia.slice(i + 1, fin - 1));
      i = fin;
    } else i++;
  }
  return salida.filter((s) => /\p{L}/u.test(s.replace(/\$\{[^}]*\}/g, '')));
}
