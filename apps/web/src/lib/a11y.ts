import type { KeyboardEvent } from 'react';

/**
 * Utilidades de accesibilidad compartidas (US-235 / AUD3-26).
 */

/**
 * Props para una **fila de tabla que abre un detalle**.
 *
 * Las cuatro tablas principales (inventario, tráfico por dispositivo, firewall y
 * peers de VPN) eran `<tr onClick>` a secas: con teclado **no había forma de abrir
 * un dispositivo ni de editar una regla**. No es un matiz de lectores de pantalla,
 * es que la app resultaba inoperable sin ratón.
 *
 * ## Por qué así y no con `role="button"`
 *
 * El patrón de referencia del repo (`FloorPlanStage.tsx`) usa `role="button"`,
 * pero allí es un `<g>` de SVG. En un `<tr>` ese rol **rompe la semántica de
 * tabla**: el navegador deja de exponer la fila como fila y un lector de pantalla
 * pierde la relación con las cabeceras (además de que axe lo marca como violación
 * de rol padre requerido). Aquí se hace focusable la fila y se le da nombre
 * accesible, conservando `row`.
 *
 * La alternativa de libro —un `<button>` real dentro de la primera celda— es más
 * ortodoxa, pero cambia el aspecto de cuatro tablas y deja fuera el resto de la
 * fila; se descartó por coste/beneficio, no por desconocimiento.
 */
export function filaAbrible(onOpen: () => void, etiqueta: string) {
  return {
    tabIndex: 0,
    'aria-label': etiqueta,
    onClick: onOpen,
    onKeyDown: (e: KeyboardEvent<HTMLTableRowElement>) => {
      // Solo cuando el foco está en la propia fila: si el usuario está sobre un
      // control interno (un interruptor, un botón de borrar), Enter/Espacio le
      // pertenecen a ese control, no a la fila.
      if (e.target !== e.currentTarget) return;
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      onOpen();
    },
  } as const;
}
