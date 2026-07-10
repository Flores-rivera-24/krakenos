import type { DiscoveryStatus } from '@krakenos/types';
import { api } from '@/lib/api';

export const getDiscovery = () => api.get<DiscoveryStatus>('/discovery');
export const scanDiscovery = () => api.post<DiscoveryStatus>('/discovery/scan');
export const dismissSuggestion = (id: string) =>
  api.del<void>(`/discovery/suggestions/${encodeURIComponent(id)}`);
