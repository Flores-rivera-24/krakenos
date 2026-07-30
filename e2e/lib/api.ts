import type { APIRequestContext } from '@playwright/test';
import { ADMIN } from './fixtures.js';

/**
 * Utilidades de **preparación** por API para los flujos e2e (US-261).
 *
 * La suite prueba la UI, no la API — pero montar el escenario por la UI (crear un
 * usuario, poner un PIN) alarga cada test, lo hace frágil y **prueba dos veces lo
 * mismo**. Aquí se prepara el estado por API y el test se centra en lo que quiere
 * demostrar: qué ve y qué puede hacer cada rol en el navegador.
 *
 * Ojo con la regla de US-174: un token de API **nunca administra**. Estos helpers
 * usan un access token de **sesión** (el de `/auth/login`), que sí puede.
 */

/**
 * Token de admin cacheado por worker.
 *
 * Sin esto, cada helper hacía su propio login y la suite se comía el **rate-limit
 * de `/auth/login`** (10/min por IP, US-47): a mitad de tanda el login empezaba a
 * devolver 429 y varios flujos caían con «No se pudo conectar con el servidor».
 * Costó un rato de diagnóstico porque el agente e2e no vuelca sus logs tras el
 * arranque — y porque la UI pinta cualquier no-401 con ese mismo mensaje.
 */
let tokenAdmin: string | null = null;

/** Inicia sesión por API y devuelve el access token (vive solo en la respuesta). */
export async function loginApi(
  request: APIRequestContext,
  creds: { email: string; password: string } = ADMIN,
): Promise<string> {
  const esAdmin = creds.email === ADMIN.email;
  if (esAdmin && tokenAdmin) return tokenAdmin;

  const res = await request.post('/api/auth/login', {
    data: { email: creds.email, password: creds.password },
  });
  if (!res.ok()) throw new Error(`login API falló (${res.status()}): ${await res.text()}`);
  const body = (await res.json()) as { tokens?: { accessToken: string } };
  const token = body.tokens?.accessToken;
  if (!token) throw new Error('el login no devolvió access token (¿2FA activo?)');
  if (esAdmin) tokenAdmin = token;
  return token;
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

export interface UsuarioE2E {
  email: string;
  password: string;
  displayName: string;
  role: 'admin' | 'member' | 'kid' | 'guest' | 'viewer';
}

/**
 * Crea un usuario con el rol pedido (idempotente: si ya existe, no falla — los
 * flujos comparten una sola DB y el orden importa, ver `docs/e2e.md`).
 */
export async function crearUsuario(request: APIRequestContext, u: UsuarioE2E): Promise<void> {
  const token = await loginApi(request);
  const res = await request.post('/api/users', {
    headers: auth(token),
    data: { email: u.email, displayName: u.displayName, password: u.password, role: u.role },
  });
  // 409 = ya existe de una ejecución anterior del mismo run: es un estado válido.
  if (!res.ok() && res.status() !== 409) {
    throw new Error(`crear usuario ${u.role} falló (${res.status()}): ${await res.text()}`);
  }
}

/** Fija (o quita, con `null`) el PIN de la alarma. Solo admin. */
export async function ponerPinDeAlarma(
  request: APIRequestContext,
  pin: string | null,
): Promise<void> {
  const token = await loginApi(request);
  const actual = await request.get('/api/alarm/config', { headers: auth(token) });
  const config = (await actual.json()) as Record<string, unknown>;
  // `hasPin` es de solo lectura (el PIN nunca se devuelve, US-188): se quita del
  // cuerpo antes de reenviar la config con el PIN nuevo.
  delete config.hasPin;
  const res = await request.put('/api/alarm/config', {
    headers: auth(token),
    data: { ...config, pin },
  });
  if (!res.ok()) throw new Error(`fijar PIN falló (${res.status()}): ${await res.text()}`);
}

/** Devuelve la alarma a `disarmed` para no contaminar el resto de flujos. */
export async function desarmarPorApi(request: APIRequestContext, pin?: string): Promise<void> {
  const token = await loginApi(request);
  await request.post('/api/alarm/disarm', {
    headers: auth(token),
    data: pin ? { pin } : {},
  });
}

/**
 * Fija el idioma **guardado** de un usuario (`User.locale`, US-177).
 *
 * Importa porque la preferencia guardada **manda sobre el idioma del navegador**
 * en cuanto hay sesión: un usuario creado desde una UI en español se queda con
 * `locale: 'es'` aunque su Chromium sea `en-US`. Es el comportamiento correcto
 * (la preferencia explícita gana) y hay que montarlo a propósito para poder
 * probar el catálogo inglés dentro de la app.
 */
export async function ponerIdioma(
  request: APIRequestContext,
  creds: { email: string; password: string },
  locale: 'es' | 'en',
): Promise<void> {
  const token = await loginApi(request, creds);
  const res = await request.patch('/api/auth/locale', {
    headers: auth(token),
    data: { locale },
  });
  if (!res.ok()) throw new Error(`fijar idioma falló (${res.status()}): ${await res.text()}`);
}
