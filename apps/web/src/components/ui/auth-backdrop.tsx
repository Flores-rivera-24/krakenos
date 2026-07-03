/**
 * Fondo "tecnológico" de las pantallas de entrada (login / setup, US-164): rejilla
 * técnica desvanecida + un halo de acento difuso. Decorativo y theme-aware (tokens
 * kr-*). El contenedor padre debe ser `relative overflow-hidden`; la tarjeta encima
 * lleva `relative z-10`.
 */
export function AuthBackdrop() {
  return (
    <>
      <div aria-hidden className="kr-grid-bg pointer-events-none absolute inset-0 opacity-50" />
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[38%] h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full bg-kr-accent-faint blur-3xl"
      />
    </>
  );
}
