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
      // Solo declara JSON cuando **hay** cuerpo: un POST/DELETE sin cuerpo pero con
      // `Content-Type: application/json` hace que Fastify rechace el body vacío con
      // 400 (bloquear/desbloquear, rescan, logout…). Detectado por e2e (US-189).
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token && !anonymous ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return undefined as T;

  /**
   * El cuerpo se lee como texto y se parsea aparte, en vez de `res.json()`.
   *
   * ⚠️ Antes esto era `await res.json().catch(() => null)`, y ese `catch` no
   * distinguía «el agente no mandó JSON» de «no se pudo LEER el cuerpo». La
   * lectura del cuerpo falla, entre otros casos, cuando la petición se **aborta**
   * porque el usuario cambió de página: la respuesta ya tiene sus cabeceras (200,
   * `res.ok` true), así que el `catch` devolvía `null` y `rawRequest` lo
   * entregaba **como si fuera el dato**, tipado con el genérico —que es un cast,
   * no una comprobación—.
   *
   * El resultado era una excepción sin relación aparente con la causa: quien
   * entraba y salía del dashboard deprisa veía `TypeError: t is not iterable` en
   * `QuickActionsWidget` (el store de favoritos se quedaba con `null` y el
   * `for…of` reventaba), de forma intermitente y solo en el build de producción.
   * Cualquier store que asigne la respuesta a su estado tenía el mismo agujero.
   *
   * Ahora un cuerpo ilegible es un **error**, que es lo que es, y nunca un dato.
   */
  const texto = await res.text();

  let data: unknown = null;
  let parseado = false;
  if (texto !== '') {
    try {
      data = JSON.parse(texto);
      parseado = true;
    } catch {
      // Cuerpo presente pero no es JSON: se trata abajo según el estado.
    }
  }

  if (!res.ok) {
    // Sin cuerpo JSON no hay mensaje del agente: se deja vacío para que
    // `describeError` use su fallback en español en lugar del statusText
    // en inglés del navegador ("Not Found", "Internal Server Error"…).
    throw new ApiRequestError(res.status, (data as ApiError) ?? { code: 'UNKNOWN', message: '' });
  }

  // Respuesta correcta sin cuerpo (algunas escrituras): no hay dato que devolver.
  if (texto === '') return undefined as T;

  if (!parseado) {
    throw new ApiRequestError(res.status, { code: 'RESPUESTA_NO_JSON', message: '' });
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
  // `opts` acepta `anonymous` (US-267): la vista previa de una invitación la abre
  // alguien que TODAVÍA no tiene cuenta, así que no debe mandar `Authorization` ni
  // intentar refrescar la sesión al recibir un 401.
  get: <T>(path: string, opts?: RequestOptions) => request<T>(path, { ...opts, method: 'GET' }),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>(path, { ...opts, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  del: <T>(path: string, opts?: { body?: unknown }) =>
    request<T>(path, { method: 'DELETE', body: opts?.body }),
};
