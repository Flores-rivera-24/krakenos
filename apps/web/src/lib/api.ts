import type { ApiError } from '@krakenos/types';
import { useAuthStore } from '@/store/auth.store';

/** Error lanzado por el cliente de API, portando el `ApiError` del agente. */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiError,
  ) {
    super(body.message);
  }
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Si `true`, no adjunta el access token ni intenta refresco. */
  anonymous?: boolean;
}

async function rawRequest<T>(path: string, options: RequestOptions): Promise<T> {
  const { body, anonymous, headers, ...rest } = options;
  const token = useAuthStore.getState().tokens?.accessToken;

  const res = await fetch(`/api${path}`, {
    ...rest,
    // Envía la cookie httpOnly del refresh token cuando aplica (logout/revoke, US-91).
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(token && !anonymous ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return undefined as T;

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiRequestError(
      res.status,
      (data as ApiError) ?? { code: 'UNKNOWN', message: res.statusText },
    );
  }
  return data as T;
}

/**
 * Cliente con refresco automático: ante un 401 intenta refrescar el token
 * una vez y reintenta la petición original.
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  try {
    return await rawRequest<T>(path, options);
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 401 && !options.anonymous) {
      const refreshed = await useAuthStore.getState().refresh();
      if (refreshed) return rawRequest<T>(path, options);
    }
    throw err;
  }
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: 'GET' }),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>(path, { ...opts, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  del: <T>(path: string, opts?: { body?: unknown }) =>
    request<T>(path, { method: 'DELETE', body: opts?.body }),
};
