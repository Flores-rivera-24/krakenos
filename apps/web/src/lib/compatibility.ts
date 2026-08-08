import type { CompatibilityEntry } from '@krakenos/types';
import { api } from '@/lib/api';

/** Catálogo de compatibilidad de hardware (US-208), derivado del código. */
export const listCompatibility = () => api.getList<CompatibilityEntry>('/compatibility');
