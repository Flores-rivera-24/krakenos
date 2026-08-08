import type {
  AdminResetPasswordRequest,
  ChangePasswordRequest,
  CreateUserRequest,
  UpdateUserRequest,
  UserSummary,
} from '@krakenos/types';
import { api } from '@/lib/api';

/** Cliente de la gestión de usuarios (US-101). Escritura reservada a admin en el servidor. */

export const listUsers = (): Promise<UserSummary[]> => api.getList<UserSummary>('/users');

export const createUser = (body: CreateUserRequest): Promise<UserSummary> =>
  api.post<UserSummary>('/users', body);

export const updateUser = (id: string, body: UpdateUserRequest): Promise<UserSummary> =>
  api.patch<UserSummary>(`/users/${id}`, body);

export const resetUserPassword = (id: string, body: AdminResetPasswordRequest): Promise<void> =>
  api.post<void>(`/users/${id}/password`, body);

export const deleteUser = (id: string): Promise<void> => api.del<void>(`/users/${id}`);

/** Cambio de la propia contraseña (cualquier usuario autenticado). */
export const changeOwnPassword = (body: ChangePasswordRequest): Promise<void> =>
  api.post<void>('/auth/change-password', body);
