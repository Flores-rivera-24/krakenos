import { useEffect, useRef } from 'react';

/** Selector de elementos que pueden recibir foco por teclado. */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'button:not([disabled])',
  'iframe',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',');

/**
 * Trampa de foco para modales (slideover/diálogo). Mientras `active`:
 * - mueve el foco al primer elemento focusable del contenedor (o al propio
 *   contenedor si no hay ninguno),
 * - cicla el foco con Tab / Shift+Tab sin salir del contenedor,
 * - al desmontar/cerrar, devuelve el foco al elemento que lo tenía antes de abrir.
 *
 * El contenedor debe tener `tabIndex={-1}` para poder recibir el foco de respaldo.
 * Devuelve la ref que hay que colocar en el contenedor del modal.
 */
export function useFocusTrap<T extends HTMLElement>(active: boolean) {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!active) return;
    const container = ref.current;
    if (!container) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusable = () =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));

    // Foco inicial: primer elemento focusable, o el propio contenedor.
    const first = focusable()[0];
    (first ?? container).focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const items = focusable();
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const firstEl = items[0]!;
      const lastEl = items[items.length - 1]!;
      const activeEl = document.activeElement;

      if (e.shiftKey) {
        if (activeEl === firstEl || !container.contains(activeEl)) {
          e.preventDefault();
          lastEl.focus();
        }
      } else if (activeEl === lastEl || !container.contains(activeEl)) {
        e.preventDefault();
        firstEl.focus();
      }
    };

    container.addEventListener('keydown', onKeyDown);
    return () => {
      container.removeEventListener('keydown', onKeyDown);
      // Devuelve el foco a quien lo tenía (si sigue en el DOM).
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
  }, [active]);

  return ref;
}
