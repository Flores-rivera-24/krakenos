import type { IntegrationConfigValues, IntegrationField } from '@krakenos/types';

/**
 * Adopción de una sugerencia del descubrimiento (US-249), **pura**.
 *
 * Hasta aquí `DiscoveryService` solo **proponía**: sus únicas escrituras eran los
 * descartes, así que el usuario veía «Encontramos un Shelly en 192.168.1.80» y a
 * continuación tenía que teclear su dirección a mano en el asistente. Este módulo
 * decide **si una sugerencia se puede dar de alta de un toque** y **cómo se funde**
 * con lo que ya hay configurado, sin pisarlo.
 *
 * Todo lo de aquí es puro: entran los valores guardados y el prefill, sale la
 * config a guardar. La escritura, el cifrado y la recarga en caliente las hace la
 * ruta reusando el mismo camino que el asistente (`saveDomainConfig`).
 */

/**
 * Cómo se funde el valor de un campo con el ya guardado. El **defecto es
 * `escalar`**, que es el seguro: no toca lo que ya hay.
 */
export type PoliticaDeFusion =
  | 'escalar' // un solo valor: se pone solo si falta (no se pisa lo configurado)
  | 'csv' // lista de direcciones separadas por comas: se añade si no está
  | 'lista-json'; // lista JSON de objetos con `ip`: se añade si esa ip no está

/**
 * Política por campo, con clave `<kind>.<campo>`. Es corta a propósito: solo
 * necesita entrada lo que alguna huella **precarga**, y un campo sin entrada cae a
 * `escalar`, que nunca destruye datos. Un olvido aquí se nota como «el segundo
 * aparato no se añadió», no como una config machacada.
 */
const POLITICA: Record<string, PoliticaDeFusion> = {
  'shelly.devices': 'lista-json',
  'kasa.kasaDeviceIps': 'csv',
  'kasa.tapoDeviceIps': 'csv',
};

/** Política de fusión de un campo concreto. */
export function politicaDe(kind: string, campo: string): PoliticaDeFusion {
  return POLITICA[`${kind}.${campo}`] ?? 'escalar';
}

/**
 * ¿Se puede dar de alta esta sugerencia **sin preguntar nada**? Tres condiciones,
 * y las tres importan:
 *
 * 1. El prefill trae algo. Una sugerencia sin datos (la cámara ONVIF: su alta real
 *    es por cámara, con credenciales) no se adopta: se abre el asistente.
 * 2. Todos los campos **obligatorios** quedan cubiertos por el prefill o por lo ya
 *    guardado.
 * 3. Ningún campo obligatorio es **secreto**. Es la condición que deja fuera a Hue:
 *    su `appKey` sale de pulsar el botón del bridge y **un prefill nunca lleva
 *    secretos**, así que «un toque» sería un botón que falla.
 *
 * Se calcula en el servidor y viaja con la sugerencia para que la UI **no pinte un
 * botón que no puede funcionar**.
 */
export function esAdoptable(
  prefill: Record<string, string>,
  campos: IntegrationField[],
  yaGuardados: IntegrationConfigValues = {},
): boolean {
  if (Object.keys(prefill).length === 0) return false;
  for (const campo of campos) {
    if (!campo.required || campo.derived) continue;
    if (campo.secret) return false;
    const delPrefill = prefill[campo.key];
    const guardado = yaGuardados[campo.key];
    const cubierto =
      (typeof delPrefill === 'string' && delPrefill !== '') ||
      (guardado !== undefined && guardado !== null && guardado !== '');
    if (!cubierto) return false;
  }
  return true;
}

/** Direcciones de una lista CSV, sin vacíos ni espacios. */
function csv(valor: unknown): string[] {
  return typeof valor === 'string'
    ? valor
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
}

/** Objetos de una lista JSON guardada; `[]` si está corrupta (parseo defensivo). */
function listaJson(valor: unknown): Record<string, unknown>[] {
  if (typeof valor !== 'string' || valor.trim() === '') return [];
  try {
    const parsed = JSON.parse(valor) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === 'object')
      : [];
  } catch {
    return [];
  }
}

/**
 * Funde el prefill con lo ya guardado y devuelve **solo los campos que cambian**,
 * ya con la clave namespaced (`shelly.devices`) que espera el dominio `iot`.
 *
 * ⚠️ **Añadir, nunca reemplazar.** El caso que la historia persigue es el segundo
 * aparato: adoptar un Shelly cuando ya hay otro tiene que dejar **los dos**. Y por
 * lo mismo un `brokerUrl` ya configurado no se pisa con el de otra sugerencia: el
 * usuario pudo haberlo ajustado a mano.
 */
export function fusionaPrefill(
  kind: string,
  prefill: Record<string, string>,
  yaGuardados: IntegrationConfigValues,
  namespaced: boolean,
): IntegrationConfigValues {
  const salida: IntegrationConfigValues = {};
  const clave = (campo: string) => (namespaced ? `${kind}.${campo}` : campo);

  for (const [campo, nuevo] of Object.entries(prefill)) {
    if (nuevo === '') continue;
    const actual = yaGuardados[clave(campo)];
    switch (politicaDe(kind, campo)) {
      case 'csv': {
        const lista = csv(actual);
        if (lista.includes(nuevo)) break; // ya estaba: nada que hacer
        salida[clave(campo)] = [...lista, nuevo].join(',');
        break;
      }
      case 'lista-json': {
        const lista = listaJson(actual);
        const entrante = listaJson(nuevo);
        const ips = new Set(lista.map((d) => String(d.ip ?? '')));
        const añadidos = entrante.filter((d) => !ips.has(String(d.ip ?? '')));
        if (añadidos.length === 0) break;
        salida[clave(campo)] = JSON.stringify([...lista, ...añadidos]);
        break;
      }
      default: {
        // Escalar: solo si no había nada. Nunca se pisa lo configurado.
        if (actual === undefined || actual === null || actual === '') salida[clave(campo)] = nuevo;
        break;
      }
    }
  }
  return salida;
}

/**
 * ¿La config guardada **demuestra** que este aparato ya está dado de alta? Se usa
 * para dejar de sugerirlo.
 *
 * ⚠️ Antes se ocultaba toda sugerencia cuyo `kind` estuviera configurado, y eso
 * enterraba **el segundo aparato de un backend que ya existe**: quien conectaba un
 * Shelly no volvía a ver ninguno más, para siempre. Ahora se oculta solo lo que se
 * puede **probar** que está: si el aparato no aparece en la config (una cámara
 * ONVIF, que se da de alta en otro sitio), la sugerencia se queda y el usuario la
 * descarta —y el descarte sí se persiste—. Enseñar de más se arregla con un clic;
 * ocultar de menos no se arregla nunca porque no se ve.
 */
export function yaConfigurado(
  kind: string,
  ip: string,
  prefill: Record<string, string>,
  yaGuardados: IntegrationConfigValues,
  namespaced: boolean,
): boolean {
  const clave = (campo: string) => (namespaced ? `${kind}.${campo}` : campo);

  for (const campo of Object.keys(prefill)) {
    const actual = yaGuardados[clave(campo)];
    if (actual === undefined || actual === null || actual === '') continue;
    switch (politicaDe(kind, campo)) {
      case 'csv':
        if (csv(actual).includes(ip)) return true;
        break;
      case 'lista-json':
        if (listaJson(actual).some((d) => String(d.ip ?? '') === ip)) return true;
        break;
      default:
        // Un escalar (bridgeUrl, brokerUrl) cubre a este aparato si apunta a su IP.
        if (typeof actual === 'string' && actual.includes(ip)) return true;
        break;
    }
  }
  return false;
}
