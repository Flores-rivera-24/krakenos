import { useEffect, useState } from 'react';

/**
 * `true` por debajo del breakpoint `md` de Tailwind (768 px).
 *
 * Vivía dentro de `InventoryPage` (US-97, para forzar la vista de tarjetas); se
 * extrae aquí porque US-239 lo necesita también en la barra lateral, que es
 * `hidden md:flex` y estaba sondeando 4 endpoints cada 8 s **en móvil, donde no
 * se pinta**. Un componente oculto por CSS sigue montado: hay que preguntarlo.
 *
 * Por defecto (jsdom/SSR, sin `matchMedia`) asume **escritorio**: es el caso en
 * el que conviene equivocarse, porque un falso «móvil» apagaría datos que sí se
 * están viendo.
 */
export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(max-width: 767px)');
    const update = () => setMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return mobile;
}
