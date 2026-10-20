import { esCore } from './catalog/es-core';

/**
 * El catálogo español **en uso**: el núcleo del arranque más los fragmentos que ya
 * se han registrado. Es el fallback de `t()` y el catálogo del propio idioma `es`.
 *
 * Lo registrado crece conforme se cargan pantallas perezosas: un fragmento se
 * registra al EVALUARSE su módulo, y ese módulo es una dependencia estática de los
 * ficheros que pintan sus claves. Como el módulo de una pantalla no se evalúa hasta
 * que sus dependencias lo han hecho, el fragmento está antes del primer render y
 * `t()` sigue siendo síncrono.
 */
export const esRegistrado: Record<string, string> = { ...esCore };

/** Añade un fragmento al catálogo español en uso. Idempotente. */
export function registrarFragmento(fragmento: Readonly<Record<string, string>>): void {
  Object.assign(esRegistrado, fragmento);
}
