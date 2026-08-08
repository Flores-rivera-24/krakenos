import type { ReactNode } from 'react';

/**
 * Mensaje de error de un formulario, **anunciado** al aparecer (US-268).
 *
 * Existía `ErrorBanner` para el error de una página entera, pero los errores de
 * un formulario se pintaban a mano como `<p className="text-kr-sm text-danger">`
 * en 15 sitios: se ven, y para un lector de pantalla **no existen**. Quien
 * rellena un formulario sin ver la pantalla pulsa «Guardar», no pasa nada
 * aparente y no tiene forma de enterarse de por qué.
 *
 * Es `role="alert"` —no `status`— porque es exactamente lo que **acaba de
 * pasar** al pulsar el botón, y se monta solo cuando hay error: un aviso
 * permanente marcado como alerta se anunciaría al cargar la página y rompería
 * cualquier `getByRole('alert')` (ver `ui/callout.tsx`).
 */
export function FormError({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="text-kr-sm text-danger">
      {children}
    </p>
  );
}
