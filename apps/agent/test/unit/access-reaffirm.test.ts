import { describe, expect, it } from 'vitest';
import {
  planDeReafirmacion,
  REAFIRMACION_INTERVALO_MS,
  REAFIRMACION_TOPE_POR_BARRIDO,
} from '../../src/access/reaffirm.js';

/**
 * Reafirmación del bloqueo (US-255). El fallo que cierra es mudo: las reglas viven
 * en el router y KrakenOS solo llamaba al driver cuando el estado deseado cambiaba,
 * así que un reinicio del router dejaba el aparato navegando con el panel diciendo
 * «Bloqueado».
 */
describe('planDeReafirmacion (US-255)', () => {
  const T0 = 1_700_000_000_000;

  it('una MAC recién bloqueada entra en la primera tanda', () => {
    // Sin marca previa: es justo la que menos evidencia tiene de haber llegado al
    // router, así que no se espera un intervalo para comprobarlo.
    const plan = planDeReafirmacion(['aa:00'], new Map(), T0);
    expect(plan.reafirmar).toEqual(['aa:00']);
  });

  it('no reafirma antes de que venza el intervalo', () => {
    const afirmadas = new Map([['aa:00', T0]]);
    expect(planDeReafirmacion(['aa:00'], afirmadas, T0 + 60_000).reafirmar).toEqual([]);
    // Justo en el límite sí: `>=`, para no depender de la deriva del temporizador.
    expect(
      planDeReafirmacion(['aa:00'], afirmadas, T0 + REAFIRMACION_INTERVALO_MS).reafirmar,
    ).toEqual(['aa:00']);
  });

  it('empieza por la más vieja y respeta el tope por barrido', () => {
    // Seis vencidas y tope de cinco: la ráfaga se reparte sola.
    const macs = ['a', 'b', 'c', 'd', 'e', 'f'];
    const afirmadas = new Map(macs.map((m, i) => [m, T0 - REAFIRMACION_INTERVALO_MS - (10 - i)]));
    const plan = planDeReafirmacion(macs, afirmadas, T0);
    expect(plan.reafirmar).toHaveLength(REAFIRMACION_TOPE_POR_BARRIDO);
    // `a` es la más vieja (mayor resta) y `f` la más reciente: se queda fuera.
    expect(plan.reafirmar).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('olvida la marca de lo que ya no debe estar bloqueado', () => {
    // Si la marca sobreviviera, una MAC que se bloquea, se suelta y se vuelve a
    // bloquear heredaría la marca vieja y pasaría un intervalo entero sin
    // comprobarse — que es el hueco que esta historia cierra.
    const plan = planDeReafirmacion(['aa:00'], new Map([['bb:11', T0]]), T0);
    expect(plan.olvidar).toEqual(['bb:11']);
    expect(plan.reafirmar).toEqual(['aa:00']);
  });

  it('sin nada bloqueado no hay trabajo que hacer', () => {
    expect(planDeReafirmacion([], new Map(), T0)).toEqual({ reafirmar: [], olvidar: [] });
  });
});
