import type { DomainState, IntegrationDomain } from '@krakenos/types';
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { api } from '@/lib/api';
import { usePolling } from '@/lib/use-polling';

/**
 * Estado de cada dominio de integración (`configured | demo | not-configured`), leído de
 * `GET /api/integrations/status`: una lectura autenticada **de cualquier rol** que lleva solo
 * `dominio → estado`. Es lo que decide si una página enseña sus datos, un aviso de
 * «Datos de demostración» o «Sin configurar»: sin esto, una instalación nueva enseñaba un
 * vacío (o, peor, una casa inventada) sin decirlo.
 *
 * Vive en un **store** y no en un `useResource` por página por dos razones:
 *  - Lo leen la barra lateral y una docena de páginas; el layout lo pide **una vez** y ellas
 *    solo leen. Pedirlo en cada página añadiría una petición a cada montaje.
 *  - **Desconocido no es un estado.** Mientras no hay respuesta (o si falla) el valor es
 *    `null` y nadie pinta ningún aviso: ante la duda, la página se ve como siempre. Un aviso
 *    de «sin configurar» sobre una casa que sí lo está sería la mentira contraria.
 */

/** Los ocho dominios. `Record` exhaustivo: un dominio nuevo no compila sin entrada. */
const DOMINIOS: Record<IntegrationDomain, true> = {
  driver: true,
  vpn: true,
  iot: true,
  cameras: true,
  firewall: true,
  vlan: true,
  qos: true,
  dns: true,
};

const ESTADOS: Record<DomainState, true> = { configured: true, demo: true, 'not-configured': true };

/** Estado conocido de cada dominio; un dominio ausente o con un valor que esta web no conoce es «no sé». */
export type EstadosConocidos = Partial<Record<IntegrationDomain, DomainState>>;

/**
 * Valida la respuesta. Un agente más nuevo puede mandar un estado que esta web no conoce: ese
 * dominio queda sin estado (no se adivina), los demás se conservan.
 */
export function parseEstados(raw: unknown): EstadosConocidos | null {
  if (!raw || typeof raw !== 'object') return null;
  const states = (raw as { states?: unknown }).states;
  if (!states || typeof states !== 'object') return null;
  const out: EstadosConocidos = {};
  for (const dominio of Object.keys(DOMINIOS) as IntegrationDomain[]) {
    const valor = (states as Record<string, unknown>)[dominio];
    if (typeof valor === 'string' && valor in ESTADOS) out[dominio] = valor as DomainState;
  }
  return out;
}

interface EstadosStore {
  /** `null` hasta que llega la primera respuesta válida. Un fallo conserva el último valor. */
  estados: EstadosConocidos | null;
  /**
   * `true` cuando la primera lectura ya TERMINÓ (bien o mal). El layout no monta la página
   * hasta entonces: una página que monta con el estado aún desconocido pide sus datos antes de
   * saber que el dominio no está conectado, y en una entrada en frío (F5) eso eran dos 409 en
   * la consola y un aviso de error parpadeando antes del «Sin configurar».
   */
  intentado: boolean;
  set: (estados: EstadosConocidos) => void;
}

export const useEstadosStore = create<EstadosStore>((set) => ({
  estados: null,
  intentado: false,
  set: (estados) => set({ estados }),
}));

/**
 * Relee el estado. Tolerante: un fallo (red, 5xx, forma rara) deja lo que había, porque
 * "no he podido preguntar" no es "ha cambiado".
 */
export async function refrescarEstados(): Promise<void> {
  try {
    const estados = parseEstados(await api.get<unknown>('/integrations/status'));
    if (estados) useEstadosStore.getState().set(estados);
  } catch {
    /* se conserva el último estado conocido */
  } finally {
    useEstadosStore.setState({ intentado: true });
  }
}

/** Estado de un dominio, o `null` si todavía no se sabe. */
export function useDomainState(domain: IntegrationDomain): DomainState | null {
  return useEstadosStore((s) => s.estados?.[domain] ?? null);
}

/** Dominios en un estado dado (en el orden de `DOMINIOS`). Vacío mientras no se sepa. */
export function useDomainsIn(state: DomainState): IntegrationDomain[] {
  const estados = useEstadosStore((s) => s.estados);
  if (!estados) return [];
  return (Object.keys(DOMINIOS) as IntegrationDomain[]).filter((d) => estados[d] === state);
}

/** Intervalo de relectura: el estado solo cambia al conectar algo, no hace falta más a menudo. */
const RELECTURA_MS = 60_000;

/**
 * Lo monta el layout, **una vez**: lee al entrar y relee cada minuto (si otro administrador
 * conecta el router, esta sesión se entera sin recargar). Va por `usePolling`: se calla con
 * la pestaña oculta. Al desmontar (cerrar sesión) se olvida el estado, para que otra persona
 * en el mismo navegador no herede el de la anterior.
 */
export function useSincronizarEstados(enabled = true): void {
  usePolling(refrescarEstados, RELECTURA_MS, { enabled });
  useEffect(() => () => useEstadosStore.setState({ estados: null, intentado: false }), []);
}

/** Tope de espera a la primera lectura: un agente que no contesta no deja la pantalla en blanco. */
const ESPERA_MAXIMA_MS = 3_000;

/**
 * ¿Se puede montar ya el contenido de las páginas? Sí en cuanto la primera lectura del estado
 * terminó (acertada o no) o pasados {@link ESPERA_MAXIMA_MS}: sin respuesta, la página sale
 * «como siempre» en vez de esperar para siempre. Lo usa el layout.
 */
export function useEstadosListos(): boolean {
  const intentado = useEstadosStore((s) => s.intentado);
  const [vencido, setVencido] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setVencido(true), ESPERA_MAXIMA_MS);
    return () => clearTimeout(id);
  }, []);
  return intentado || vencido;
}
