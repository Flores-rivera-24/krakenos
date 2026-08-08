import type {
  AcceptInvitationRequest,
  AccessRequest,
  AccessRequestStatus,
  CreateAccessRequestRequest,
  CreateInvitationRequest,
  CreateInvitationResponse,
  DecideAccessRequestRequest,
  DecideAccessRequestResponse,
  Invitation,
  InvitationPreview,
} from '@krakenos/types';
import { api } from '@/lib/api';

/** Cliente de las dos vías de alta (US-272 invitaciones · US-273 solicitudes). */

// `getList` y no un GET con genérico de lista: el genérico es un cast que no
// comprueba nada en runtime, así que un 200 con otra forma se asignaría al estado y
// reventaría en el `.map()` de la tarjeta, lejos de la causa.
// (El literal del patrón prohibido no se escribe aquí: el gate `get-lista` busca por
// texto y no distingue código de comentario, así que citarlo se delata a sí mismo.)
export const listInvitations = (): Promise<Invitation[]> => api.getList<Invitation>('/invitations');

export const createInvitation = (body: CreateInvitationRequest): Promise<CreateInvitationResponse> =>
  api.post<CreateInvitationResponse>('/invitations', body);

export const revokeInvitation = (id: string): Promise<void> => api.del<void>(`/invitations/${id}`);

/** Público: lo que ve quien abre el enlace. */
export const previewInvitation = (token: string): Promise<InvitationPreview> =>
  api.get<InvitationPreview>(`/invitations/redeem/${token}`, { anonymous: true });

export const listAccessRequests = (status?: AccessRequestStatus): Promise<AccessRequest[]> =>
  api.getList<AccessRequest>(`/access-requests${status ? `?status=${status}` : ''}`);

export const decideAccessRequest = (
  id: string,
  body: DecideAccessRequestRequest,
): Promise<DecideAccessRequestResponse> =>
  api.post<DecideAccessRequestResponse>(`/access-requests/${id}/decide`, body);

/** Público: pedir acceso desde la pantalla de entrada. Responde 202 sin cuerpo. */
export const requestAccess = (body: CreateAccessRequestRequest): Promise<void> =>
  api.post<void>('/access-requests', body, { anonymous: true });

/**
 * Público: aceptar la invitación. Emite sesión, así que se llama con `fetch` directo
 * y `credentials` para que la cookie `httpOnly` del refresh se guarde — igual que el
 * login, y a diferencia del resto del cliente, que solo mueve JSON.
 */
export async function acceptInvitation(
  token: string,
  body: AcceptInvitationRequest,
): Promise<{ user: { id: string }; tokens: { accessToken: string; expiresIn: number } }> {
  const res = await fetch(`/api/invitations/redeem/${token}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(detail.message ?? 'No se pudo aceptar la invitación');
  }
  return res.json() as Promise<{
    user: { id: string };
    tokens: { accessToken: string; expiresIn: number };
  }>;
}
