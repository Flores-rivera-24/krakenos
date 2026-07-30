import type {
  PeopleResponse,
  PersonActionResult,
  PersonSummary,
  SetBedtimeRequest,
} from '@krakenos/types';
import { api } from '@/lib/api';

/**
 * Cliente de las personas del hogar (US-240). La unidad es la persona: el fan-out
 * a sus dispositivos lo hace el servidor, que es quien sabe cuáles son.
 */

export const listPeople = (): Promise<PeopleResponse> => api.get<PeopleResponse>('/people');

export const pausePerson = (userId: string, minutes: number): Promise<PersonActionResult> =>
  api.post<PersonActionResult>(`/people/${userId}/pause`, { minutes });

export const resumePerson = (userId: string): Promise<PersonActionResult> =>
  api.post<PersonActionResult>(`/people/${userId}/resume`);

export const setBedtime = (
  userId: string,
  body: SetBedtimeRequest,
): Promise<PersonActionResult> => api.put<PersonActionResult>(`/people/${userId}/bedtime`, body);

export const clearBedtime = (userId: string): Promise<PersonActionResult> =>
  api.del<PersonActionResult>(`/people/${userId}/bedtime`);

/** ¿Tiene alguna pausa viva ahora mismo? */
export const isPaused = (person: PersonSummary): boolean =>
  person.pausedUntil !== null && new Date(person.pausedUntil).getTime() > Date.now();

/** Hora de fin de una pausa, en formato corto local. */
export const formatUntil = (iso: string): string =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
