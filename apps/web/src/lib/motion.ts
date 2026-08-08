/**
 * Preferencia de movimiento del usuario (US-266).
 *
 * Existe como función única —y no como un `window.matchMedia(...)` repetido en
 * cada componente— por dos motivos:
 *
 * 1. **No puede tumbar la pantalla.** `matchMedia` es opcional en entornos que no
 *    son un navegador (jsdom no lo trae). Un componente que lo llame a pelo lanza
 *    `TypeError` dentro de un efecto y deja la página en blanco; el fondo animado
 *    es decoración, y la decoración nunca puede ser la razón de que no se vea el
 *    formulario de acceso.
 * 2. El defecto ante la duda es `false` (**sí** animar), que es lo que hace un
 *    navegador sin la preferencia puesta. Negar el movimiento por no poder
 *    preguntarlo apagaría la animación en todas partes sin que nadie lo pidiera.
 *
 * El CSS tiene su propio bloque `@media (prefers-reduced-motion: reduce)`; esto es
 * para lo que se decide en JavaScript (bucles de `canvas`, paralaje del puntero).
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
