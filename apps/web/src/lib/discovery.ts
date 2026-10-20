import type { DiscoveryStatus } from '@krakenos/types';
import { api } from '@/lib/api';
import { refrescarEstados } from '@/lib/integration-states';

export const getDiscovery = () => api.get<DiscoveryStatus>('/discovery');
export const scanDiscovery = () => api.post<DiscoveryStatus>('/discovery/scan');
export const dismissSuggestion = (id: string) =>
  api.del<void>(`/discovery/suggestions/${encodeURIComponent(id)}`);

/**
 * Da de alta una sugerencia **de un toque** (US-249). Devuelve el estado ya
 * recalculado: la sugerencia adoptada desaparece de la lista sin pedirlo aparte.
 * Un `400 DISCOVERY_NEEDS_INPUT` significa que ese aparato necesita algo que solo
 * puede dar la persona (el bridge Hue, su botón) → abrir el asistente.
 */
export const adoptSuggestion = async (id: string) => {
  const status = await api.post<DiscoveryStatus>(
    `/discovery/suggestions/${encodeURIComponent(id)}/adopt`,
  );
  // Adoptar escribe la config de un dominio: ya no está «sin configurar».
  void refrescarEstados();
  return status;
};
