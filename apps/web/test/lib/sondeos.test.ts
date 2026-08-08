import { describe, expect, it } from 'vitest';
import { fuentes } from './_fuentes';

/**
 * Gate: todo sondeo de red pasa por `usePolling` (US-262).
 *
 * El invariante es de US-239 (AUD3-27), que midió **~62 peticiones por minuto en
 * reposo** y cero coincidencias de `visibilitychange` en `src/`: la app
 * interrogaba al agente igual con la pestaña en segundo plano y el móvil en el
 * bolsillo. `usePolling` lo cerró… y quedó escrito como convención.
 *
 * Una convención que hay que recordar en cada pantalla nueva se incumple, y así
 * fue: al empezar esta historia había **cinco** sondeos de red con `setInterval` a
 * pelo —alarma (3 s), sistema (5 s), cámaras (3 s), actualización (5 s) y salud
 * (5 s)—, todos pidiendo con la pestaña oculta. El más caro devolvía una foto.
 *
 * Es el mismo razonamiento que llevó el barrido de `safeFetch` del agente de una
 * lista escrita a mano a un gate derivado del código: un invariante sobre todo el
 * árbol no se sostiene con la memoria de quien escribe la siguiente pantalla.
 *
 * ## Qué NO cuenta como sondeo
 *
 * Un `setInterval` que solo mueve un reloj **local** no pide nada, así que no
 * tiene nada que ver con este invariante: apagarlo con la pestaña oculta no
 * ahorra una sola petición. Van declarados uno a uno, con su porqué, porque una
 * excepción sin motivo escrito es por donde vuelve a entrar el defecto.
 */

/**
 * Relojes locales, sin I/O. Cada entrada dice qué cuenta y por qué no es red.
 *
 * ⚠️ Añadir algo aquí solo es correcto si **no hace ninguna petición**. Si hace
 * I/O, la respuesta no es la excepción: es `usePolling`.
 */
const RELOJES_LOCALES: Record<string, string> = {
  'lib/realtime.ts': 'useNow: re-renderiza para reevaluar la antigüedad de las muestras ya recibidas',
  'components/dashboard/widgets/AlarmWidget.tsx':
    'useCountdown: cuenta atrás sobre un `endsAt` que ya está en memoria',
};

describe('sondeos de red', () => {
  const codigo = fuentes().filter((f) => f.nombre !== 'lib/use-polling.ts');

  it('encuentra el árbol: si el recorrido se rompe, el gate no pasa en vacío', () => {
    expect(codigo.length).toBeGreaterThan(100);
  });

  it('nadie llama a `setInterval` salvo los relojes locales declarados', () => {
    const culpables = codigo
      .filter((f) => /\bsetInterval\s*\(/.test(f.codigo))
      .map((f) => f.nombre)
      .filter((nombre) => !(nombre in RELOJES_LOCALES));

    // El mensaje tiene que decir qué hacer sin volver a ejecutar nada: quien lo
    // vea está añadiendo una pantalla, no auditando el historial del invariante.
    expect(
      culpables,
      'Un sondeo nuevo va por `usePolling` (se calla con la pestaña oculta y relee al volver). ' +
        'Si es un reloj local que no pide nada, decláralo en RELOJES_LOCALES con su porqué.',
    ).toEqual([]);
  });

  it('las excepciones declaradas siguen existiendo', () => {
    // Una allowlist que nombra ficheros que ya no tienen `setInterval` es ruido
    // que sobrevive al motivo por el que se escribió, y el día que alguien meta
    // un sondeo de verdad en ese fichero ya está exculpado de antemano.
    const conIntervalo = new Set(
      codigo.filter((f) => /\bsetInterval\s*\(/.test(f.codigo)).map((f) => f.nombre),
    );
    const sobran = Object.keys(RELOJES_LOCALES).filter((n) => !conIntervalo.has(n));
    expect(sobran).toEqual([]);
  });
});
