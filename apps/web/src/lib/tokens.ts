import type {
  ApiTokenInfo,
  CreateApiTokenRequest,
  CreateApiTokenResponse,
} from '@krakenos/types';
import { api } from '@/lib/api';

/** Cliente de los tokens personales de API (US-174). Autoservicio por usuario. */
export const listApiTokens = () => api.get<ApiTokenInfo[]>('/tokens');
export const createApiToken = (body: CreateApiTokenRequest) =>
  api.post<CreateApiTokenResponse>('/tokens', body);
export const revokeApiToken = (id: string) => api.del<void>(`/tokens/${id}`);
