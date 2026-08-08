import { describe, expect, it } from 'vitest';
import { fuentes } from './_fuentes';

/**
 * Gate de trinquete: el copy sin traducir **no puede crecer** (US-270).
 *
 * ## Por qué un trinquete y no un cero
 *
 * `CLAUDE.md` daba la i18n por hecha en «shell, auth, las 18 páginas, las guías,
 * las primitivas de `ui/` y los 12 widgets», y es cierto — pero las **tarjetas,
 * secciones y slideovers nunca se migraron**. Al medirlo salieron **217 cadenas
 * en 38 ficheros** en superficies que llegan a pantalla. Ponerlo a cero de golpe
 * es una historia propia; dejarlo sin vigilar es garantizar que mañana sean 240,
 * porque el camino de menor resistencia al añadir una pantalla es escribir el
 * texto a pelo.
 *
 * Así que se congela lo medido **fichero a fichero** y se exige que solo baje. Un
 * fichero nuevo con copy a pelo se pone rojo; uno existente que crece, también.
 *
 * ⚠️ Y el trinquete aprieta en los dos sentidos: si un fichero **baja**, el test
 * pide actualizar su número. Un tope que se queda por encima de lo real deja
 * sitio libre para volver a meter copy sin que nadie se entere, que es como una
 * allowlist se convierte en permiso.
 */

/** Pistas de español: acentos y signos propios, o palabras funcionales frecuentes. */
const ESPANOL =
  /[áéíóúüñ¿¡]|\b(?:el|la|los|las|un|una|de|del|con|sin|para|por|que|se|su|tu|no|sí|más|cada|todos|desde|hasta|pudo|hay|está|están|este|esta|qué|cuando|entonces)\b/i;

/**
 * Dónde una cadena acaba **en pantalla**. No se escanea el fichero entero: una
 * cadena en una constante interna o en una clave de `localStorage` no es copy, y
 * un gate que las contara obligaría a silenciarlo.
 */
const SUPERFICIES: { nombre: string; re: RegExp }[] = [
  { nombre: 'aria-label', re: /aria-label=\{?["'`]([^"'`]{4,})["'`]/g },
  { nombre: 'title', re: /\btitle=\{?["'`]([^"'`]{4,})["'`]/g },
  { nombre: 'placeholder', re: /placeholder=\{?["'`]([^"'`]{4,})["'`]/g },
  { nombre: 'label', re: /\blabel=\{?["'`]([^"'`]{4,})["'`]/g },
  { nombre: 'what', re: /\bwhat=\{?["'`]([^"'`]{4,})["'`]/g },
  { nombre: 'toast', re: /toast\.(?:error|success|info)\(\s*[`'"]([^`'"]{4,})[`'"]/g },
  { nombre: 'describeError', re: /describeError\([^,]+,\s*[`'"]([^`'"]{4,})[`'"]/g },
  { nombre: 'texto-jsx', re: />\s*([A-ZÁÉÍÓÚ¿¡][^<>{}\n]{6,})\s*</g },
];

/**
 * Fuera del barrido a propósito:
 *  - `lib/i18n/catalog/`: **son** el copy, en los dos idiomas.
 *  - `lib/guides/`: las guías se traducen por superposición según `guide.id`
 *    (US-177), que es otro mecanismo y tiene sus propios gates de paridad.
 */
const FUERA_DE_ALCANCE = ['lib/i18n/catalog/', 'lib/guides/'];

/**
 * Deuda medida el 2026-08-08, fichero a fichero. **Solo puede bajar.**
 *
 * No es una lista de excepciones perdonadas: es el inventario de lo que queda
 * por migrar, con su tamaño, para que se pueda planificar y para que se note
 * cuando alguien lo empeora.
 */
const DEUDA: Record<string, number> = {
  'components/cameras/CameraFormSlideover.tsx': 4,
  'components/coverage/ApPalette.tsx': 8,
  'components/coverage/HeatmapLegend.tsx': 3,
  'components/coverage/SurveyPanel.tsx': 12,
  'components/dashboard/widgets/CoverageWidget.tsx': 4,
  'components/dashboard/widgets/HomeModeWidget.tsx': 4,
  'components/dns/DnsFeeds.tsx': 3,
  'components/vpn/VpnPeerSlideover.tsx': 4,
  'components/wifi/GuestNetworkCard.tsx': 10,
  'components/wifi/MainNetworkCard.tsx': 5,
};

/** Cuenta las cadenas de copy en español de **un** fichero. */
function contar(codigo: string): number {
  let n = 0;
  for (const { re } of SUPERFICIES) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(codigo)) !== null) {
      const texto = m[1]!.trim();
      if (!ESPANOL.test(texto)) continue;
      if (/^[A-Z_]+$/.test(texto)) continue; // constantes, no copy
      n++;
    }
  }
  return n;
}

function contarPorFichero(): Map<string, number> {
  const conteo = new Map<string, number>();
  for (const { nombre, codigo } of fuentes()) {
    if (FUERA_DE_ALCANCE.some((p) => nombre.includes(p))) continue;
    const n = contar(codigo);
    if (n > 0) conteo.set(nombre, n);
  }
  return conteo;
}

/**
 * Fichero sintético con copy a pelo en varias superficies. Es el **control
 * positivo** del gate: demuestra que el detector sigue detectando.
 *
 * Sustituye al guard que exigía «más de 10 ficheros con deuda». Aquel medía la
 * salud del barrido con el tamaño de la deuda **real**, así que se ponía rojo al
 * terminar de migrar —justo cuando el gate empieza a valer— y la salida cómoda
 * habría sido bajarle el número hasta apagarlo. Este no depende de cuánta deuda
 * quede: si alguien rompe el recorrido o las expresiones, se pone rojo aunque el
 * árbol esté impecable.
 */
const MUESTRA_CON_COPY = [
  'const a = <button aria-label="Cerrar la sesión" />;',
  'const b = <Input placeholder="Nombre del hogar" />;',
  "toast.success('Se guardó el cambio');",
  'const d = <span>Sin dispositivos todavía</span>;',
].join('\n');

describe('copy sin traducir (trinquete, US-270)', () => {
  const actual = contarPorFichero();

  it('el barrido encuentra el árbol', () => {
    // Sin este guard, romper el recorrido dejaría el mapa vacío y los dos tests
    // de abajo pasarían **sin haber mirado nada**.
    expect(fuentes().length).toBeGreaterThan(100);
  });

  it('el detector sigue detectando (control positivo)', () => {
    // Si esto baja a 0, el gate está ciego y los dos tests de abajo son adorno.
    //
    // Son 5 y no 4 con cuatro cadenas: `aria-label=` casa **también** con la
    // superficie `label` (`\blabel=`, y el guion es frontera de palabra), así
    // que un `aria-label` cuenta doble. Es como el detector lleva contando
    // desde US-270 y los números de `DEUDA` están medidos con ese sesgo, así
    // que se deja: corregirlo movería todas las cifras a la vez y no diría nada
    // nuevo sobre el copy. Queda escrito para que nadie lo lea como un fallo.
    expect(contar(MUESTRA_CON_COPY)).toBe(5);
  });

  it('ningún fichero nuevo escribe copy visible a pelo', () => {
    const nuevos = [...actual.keys()].filter((f) => !(f in DEUDA));
    expect(
      nuevos,
      'Copy visible escrito en el componente. Añade la clave a `catalog/es.ts` y ' +
        '`catalog/en.ts` y píntalo con `t()`; el catálogo `en` está tipado, así que ' +
        'falta de clave no compila.',
    ).toEqual([]);
  });

  it('ningún fichero conocido empeora, y el que mejora actualiza su número', () => {
    const desviados = [...actual.entries()]
      .filter(([f]) => f in DEUDA)
      .filter(([f, n]) => n !== DEUDA[f])
      .map(([f, n]) => `${f}: ${DEUDA[f]} → ${n}`);

    // Los que desaparecen del todo también tienen que salir de la lista: una
    // entrada que ya no corresponde a nada es sitio libre para reintroducir copy.
    const desaparecidos = Object.keys(DEUDA).filter((f) => !actual.has(f));

    expect(
      [...desviados, ...desaparecidos.map((f) => `${f}: ${DEUDA[f]} → 0 (quítalo de DEUDA)`)],
      'El trinquete aprieta en los dos sentidos: si baja, baja también el número.',
    ).toEqual([]);
  });
});
