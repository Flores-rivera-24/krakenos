/**
 * Aviso de destino nuevo (US-253) — **núcleo puro**.
 *
 * ## La decisión que define esta historia
 *
 * La historia pide avisar cuando un aparato contacta con un destino que **nunca**
 * había contactado. Pero `DnsQueryLog` se poda a los **7 días**
 * (`DNS_QUERY_RETENTION_DAYS`, la retención más corta del sistema, y así a
 * propósito): sobre ese historial, «nunca» no es sabible — pasada una semana,
 * todo vuelve a parecer nuevo y el aviso se convierte en ruido periódico.
 *
 * Se resuelve con un registro aparte (`KnownDestination`) que guarda **solo**
 * `(mac, dominio registrable, primera vez)`. Dos propiedades lo hacen aceptable:
 *
 * 1. **Guarda el dominio registrable, no el FQDN.** `sdk.stats.example.com` se
 *    reduce a `example.com`. Sirve igual para «este aparato empezó a hablar con
 *    alguien nuevo» y **deja de servir** para reconstruir navegación, que es
 *    justo lo que la retención de 7 días protege. Un registro permanente del
 *    FQDN sería más invasivo que el historial que lo alimenta — habría cerrado
 *    la puerta por delante y abierto una ventana por detrás.
 * 2. **Tiene retención propia y declarada.** «Nunca» es siempre «nunca dentro de
 *    la ventana que se enseña»; prometer más sería mentir.
 */

/**
 * Etiquetas de segundo nivel que son **parte del sufijo**, no del nombre, cuando
 * cuelgan de un TLD de país: en `bbc.co.uk` el dominio registrable es
 * `bbc.co.uk`, no `co.uk`.
 *
 * Es una **heurística deliberada** en vez de la Public Suffix List (que sería una
 * dependencia más una descarga periódica). Se aplica solo bajo un ccTLD de dos
 * letras, que es donde vive el patrón.
 *
 * ⚠️ **Equivocarse aquí resta avisos, no los suma** — al revés de lo que parece.
 * Si un caso se escapa, el nombre colapsa al sufijo genérico (`com.pk`) y
 * entonces **todos** los dominios de ese país cuentan como un único destino ya
 * conocido: el aviso deja de saltar y nadie lo nota. Por eso la regla es una
 * lista de segundos niveles genéricos y no una lista de sufijos completos: los
 * segundos niveles son pocos y estables; los sufijos, miles.
 */
const SEGUNDO_NIVEL_DE_SUFIJO = new Set([
  'com', 'co', 'net', 'org', 'gov', 'gob', 'edu', 'ac', 'or', 'ne', 'mil', 'nom',
]);

/**
 * Dominio registrable (eTLD+1) de un nombre. Normaliza a minúsculas y quita el
 * punto final absoluto. Devuelve `null` para lo que no es un nombre de dominio
 * utilizable — un `localhost`, una etiqueta suelta o una IP literal no
 * identifican un «destino» del que avisar.
 */
export function dominioRegistrable(fqdn: string): string | null {
  const limpio = fqdn.trim().toLowerCase().replace(/\.$/, '');
  if (limpio === '') return null;
  // Una IP literal no es un destino con nombre: avisar de «192.168.1.10» no le
  // dice nada a nadie y además suele ser tráfico interno.
  if (/^[0-9.]+$/.test(limpio) || limpio.includes(':')) return null;
  const partes = limpio.split('.').filter((p) => p !== '');
  if (partes.length < 2) return null;
  const tld = partes[partes.length - 1]!;
  const segundo = partes[partes.length - 2]!;
  // Tres etiquetas solo bajo un ccTLD (dos letras) cuyo segundo nivel sea uno de
  // los genéricos: `bbc.co.uk` sí, `example.co` (Colombia) no.
  const compuesto = tld.length === 2 && SEGUNDO_NIVEL_DE_SUFIJO.has(segundo);
  const necesarias = compuesto ? 3 : 2;
  if (partes.length < necesarias) return null;
  return partes.slice(-necesarias).join('.');
}

/** Una consulta ya atribuida a un aparato. */
export interface ConsultaAtribuida {
  mac: string;
  domain: string;
  /** Instante de la consulta (ms epoch). */
  at: number;
}

/** Lo que ya consta de un aparato. */
export interface AparatoConocido {
  /** Dominios registrables ya vistos. */
  dominios: ReadonlySet<string>;
  /**
   * Instante (ms epoch) en que se empezó a observar este aparato, o `null` si
   * es la primera vez que se ve.
   */
  observadoDesde: number | null;
}

export interface DestinoNuevo {
  mac: string;
  domain: string;
  at: number;
}

export interface PlanDeAviso {
  /** Destinos que hay que **registrar** (todos los no conocidos). */
  aRegistrar: DestinoNuevo[];
  /**
   * Destinos de los que además hay que **avisar**. Es un subconjunto de
   * `aRegistrar`: durante el aprendizaje se registra sin avisar.
   */
  aAvisar: DestinoNuevo[];
}

/**
 * Decide qué destinos son nuevos y de cuáles se avisa.
 *
 * **Periodo de aprendizaje.** Un aparato recién observado tiene *todos* sus
 * destinos «nuevos»: avisar de ellos produciría decenas de notificaciones
 * inútiles el primer día y enseñaría al usuario a ignorarlas — que es la forma
 * más eficaz de inutilizar un aviso de seguridad. Durante `graciaMs` desde la
 * primera observación se registra en silencio. Un aparato **nuevo** en la red
 * tampoco avisa por sus primeros destinos, y eso es correcto: de que un aparato
 * desconocido aparezca ya avisa `inventory.unknown_device`; este aviso es para
 * **cambios de comportamiento** de lo que ya estaba.
 */
export function planDeAviso(
  consultas: readonly ConsultaAtribuida[],
  conocidos: ReadonlyMap<string, AparatoConocido>,
  graciaMs: number,
  ahora: number,
): PlanDeAviso {
  const aRegistrar: DestinoNuevo[] = [];
  const aAvisar: DestinoNuevo[] = [];
  // Lo visto en esta misma tanda cuenta como conocido: dos consultas al mismo
  // dominio en el mismo barrido son un destino, no dos.
  const vistosAhora = new Map<string, Set<string>>();

  for (const consulta of consultas) {
    const domain = dominioRegistrable(consulta.domain);
    if (domain === null) continue;

    const previo = conocidos.get(consulta.mac);
    if (previo?.dominios.has(domain)) continue;
    const enTanda = vistosAhora.get(consulta.mac);
    if (enTanda?.has(domain)) continue;
    if (enTanda) enTanda.add(domain);
    else vistosAhora.set(consulta.mac, new Set([domain]));

    const destino: DestinoNuevo = { mac: consulta.mac, domain, at: consulta.at };
    aRegistrar.push(destino);

    // Sin observación previa, el aparato entra ahora en aprendizaje.
    const desde = previo?.observadoDesde ?? null;
    if (desde !== null && ahora - desde >= graciaMs) aAvisar.push(destino);
  }

  return { aRegistrar, aAvisar };
}

/**
 * Texto del aviso. Nombra **aparato y dominio** porque sin ellos el aviso no
 * sirve para nada — y por eso mismo su audiencia es solo admin: es actividad por
 * aparato (`home.activity`), la misma que US-250 cerró a los demás roles.
 */
export function detalleDeAviso(etiqueta: string, domain: string): string {
  return `${etiqueta} ha contactado por primera vez con ${domain}`;
}
