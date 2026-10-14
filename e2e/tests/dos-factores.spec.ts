import { expect, test, type CDPSession } from '@playwright/test';
import { crearUsuario } from '../lib/api.js';
import { ORIGIN_2FA } from '../lib/server.js';

/**
 * 2FA con passkey (US-50/51) con un **autenticador virtual** de Chromium (CDP).
 *
 * La ceremonia WebAuthn no se puede mockear a nivel de página sin dejar de probar
 * lo que importa (que el navegador, el cliente y el servidor se entiendan), así
 * que se le da al navegador un autenticador CTAP2 interno que verifica al usuario
 * solo. Dos requisitos del montaje:
 *
 *  · El RP ID es un hostname, no una IP: el flujo navega por `localhost` y el
 *    agente e2e arranca con `WEBAUTHN_ORIGIN` = ese origen (`lib/server.ts`).
 *  · Usa **su propio usuario**. Una passkey en el admin le exigiría el segundo
 *    paso a todos los demás flujos, que hacen login por UI con él.
 */

// Un usuario NUEVO por ejecución: la passkey queda en la DB pero el autenticador
// virtual muere con el contexto, así que reutilizar el usuario (p. ej. con
// `--repeat-each`) pediría un segundo factor que ya nadie puede dar.
const USUARIO = {
  email: `e2e-2fa-${Date.now()}@krakenos.test`,
  password: 'contrasena-e2e-123',
  displayName: 'Dos Factores',
  role: 'member' as const,
};

test.use({ baseURL: ORIGIN_2FA });

test('login con 2FA: registrar una passkey y entrar con ella tras la contraseña', async ({
  page,
  request,
}) => {
  await crearUsuario(request, USUARIO);

  const cdp: CDPSession = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });

  const entrar = async () => {
    await page.goto('/login');
    await page.getByLabel('Correo electrónico').fill(USUARIO.email);
    await page.getByLabel('Contraseña', { exact: true }).fill(USUARIO.password);
    await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  };

  // 1) Sin passkey, la contraseña basta. Se registra una desde Ajustes.
  await entrar();
  await page.waitForURL('**/');
  await page.getByRole('link', { name: 'Ajustes' }).first().click();
  await page.getByRole('button', { name: 'Seguridad', exact: true }).click();
  await page.getByRole('button', { name: 'Añadir passkey' }).click();
  await page.getByLabel('Nombre para esta passkey').fill('Virtual E2E');
  await page.getByRole('button', { name: 'Registrar', exact: true }).click();
  await expect(page.getByText('Virtual E2E')).toBeVisible();

  // El autenticador guarda la credencial: sin ella no habría con qué volver a entrar.
  const { credentials } = await cdp.send('WebAuthn.getCredentials', { authenticatorId });
  expect(credentials).toHaveLength(1);

  // 2) Cerrar sesión y volver a entrar: la contraseña ya no basta, pide la passkey.
  await page.getByRole('button', { name: 'Salir', exact: true }).click();
  await entrar();
  await expect(page.getByText('Verifica tu identidad con tu dispositivo')).toBeVisible();
  await page.getByRole('button', { name: 'Usar passkey' }).click();

  // 3) Segundo factor superado: dashboard.
  await page.waitForURL('**/');
  await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible();
});
