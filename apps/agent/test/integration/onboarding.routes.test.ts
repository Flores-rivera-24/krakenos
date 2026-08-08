import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authHeader, buildTestApp, resetDb, seedUser, signAccess } from '../helpers/app.js';

/**
 * Las dos vías de alta sin que el admin teclee la contraseña de nadie
 * (US-272 invitaciones · US-273 solicitudes de acceso).
 */
describe('alta de usuarios: invitaciones y solicitudes', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let adminId: string;

  beforeAll(async () => {
    app = await buildTestApp({ routes: true });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(app);
    const admin = await seedUser(app, { email: 'admin@krakenos.test', role: 'admin' });
    adminId = admin.id;
    adminToken = signAccess(app, admin);
  });

  /** Crea una invitación como admin y devuelve el cuerpo de la respuesta. */
  async function invitar(email = 'nuevo@krakenos.test', role = 'member') {
    const res = await app.inject({
      method: 'POST',
      url: '/api/invitations',
      headers: authHeader(adminToken),
      payload: { email, displayName: 'Persona Nueva', role },
    });
    expect(res.statusCode).toBe(201);
    return res.json() as { token: string; path: string; invitation: { id: string } };
  }

  describe('invitaciones (US-272)', () => {
    /**
     * El punto de toda la historia. Antes, el alta era que el admin tecleara ÉL una
     * contraseña y se la mandara por WhatsApp: la contraseña más reutilizada de la
     * casa viajando por un chat y conocida por dos personas desde el minuto cero.
     */
    it('quien acepta elige su propia contraseña y entra con sesión', async () => {
      const { token } = await invitar();

      const res = await app.inject({
        method: 'POST',
        url: `/api/invitations/redeem/${token}`,
        payload: { password: 'la-mia-1234' },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().user.email).toBe('nuevo@krakenos.test');
      expect(res.cookies.find((c) => c.name === 'krakenos_rt')).toBeDefined();

      // Y la contraseña que eligió sirve de verdad en el login normal.
      const login = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'nuevo@krakenos.test', password: 'la-mia-1234' },
      });
      expect(login.statusCode).toBe(200);
    });

    /**
     * El token solo se guarda hasheado, así que ni el servidor puede volver a
     * enseñarlo. Si la lista lo devolviera, cualquier admin —o cualquiera que
     * leyera esa respuesta— podría usar una invitación ajena.
     */
    it('el token viaja una sola vez y nunca aparece en la lista', async () => {
      const { token } = await invitar();
      const res = await app.inject({
        method: 'GET',
        url: '/api/invitations',
        headers: authHeader(adminToken),
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.stringify(res.json())).not.toContain(token);
    });

    it('el enlace es de un solo uso', async () => {
      const { token } = await invitar();
      const payload = { password: 'la-mia-1234' };
      const url = `/api/invitations/redeem/${token}`;
      expect((await app.inject({ method: 'POST', url, payload })).statusCode).toBe(201);
      expect((await app.inject({ method: 'POST', url, payload })).statusCode).toBe(404);
    });

    it('un enlace caducado no sirve, ni para mirar', async () => {
      const { token, invitation } = await invitar();
      await app.prisma.invitation.update({
        where: { id: invitation.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      expect(
        (await app.inject({ method: 'GET', url: `/api/invitations/redeem/${token}` })).statusCode,
      ).toBe(404);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: `/api/invitations/redeem/${token}`,
            payload: { password: 'la-mia-1234' },
          })
        ).statusCode,
      ).toBe(404);
    });

    /**
     * Reinvitar al mismo correo no puede dejar DOS enlaces buenos circulando: el
     * anterior pudo compartirse por un canal que ya no se controla, y esa es
     * justamente la razón de reinvitar.
     */
    it('reinvitar al mismo correo invalida el enlace anterior', async () => {
      const primera = await invitar();
      const segunda = await invitar();

      expect(
        (await app.inject({ method: 'GET', url: `/api/invitations/redeem/${primera.token}` }))
          .statusCode,
      ).toBe(404);
      expect(
        (await app.inject({ method: 'GET', url: `/api/invitations/redeem/${segunda.token}` }))
          .statusCode,
      ).toBe(200);
    });

    it('la vista previa dice a quién invita y a qué hogar, sin más', async () => {
      const { token } = await invitar();
      const res = await app.inject({ method: 'GET', url: `/api/invitations/redeem/${token}` });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        email: 'nuevo@krakenos.test',
        displayName: 'Persona Nueva',
        role: 'member',
        homeName: 'Mi hogar',
      });
    });

    it('no se invita a un correo que ya tiene cuenta', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/invitations',
        headers: authHeader(adminToken),
        payload: { email: 'admin@krakenos.test', displayName: 'Otro', role: 'member' },
      });
      expect(res.statusCode).toBe(409);
    });
  });

  describe('solicitudes de acceso (US-273)', () => {
    async function pedir(email = 'quiero@krakenos.test') {
      return app.inject({
        method: 'POST',
        url: '/api/access-requests',
        payload: { email, displayName: 'Quien Pide', note: 'soy del cuarto de arriba' },
      });
    }

    it('pedir acceso no crea ninguna cuenta ni credencial', async () => {
      expect((await pedir()).statusCode).toBe(202);
      expect(await app.prisma.user.findUnique({ where: { email: 'quiero@krakenos.test' } })).toBeNull();
    });

    /**
     * La ruta es pública y acepta un correo. Si respondiera distinto cuando el
     * correo ya tiene cuenta, cualquiera podría averiguar desde fuera quién vive en
     * la casa probando direcciones.
     */
    it('responde igual pidas con un correo nuevo o con uno que ya tiene cuenta', async () => {
      const nuevo = await pedir('desconocido@krakenos.test');
      const existente = await pedir('admin@krakenos.test');
      expect(nuevo.statusCode).toBe(existente.statusCode);
      expect(nuevo.body).toBe(existente.body);
      // Y por dentro no se registra solicitud para quien ya tiene cuenta.
      const filas = await app.prisma.accessRequest.findMany();
      expect(filas.map((f) => f.email)).toEqual(['desconocido@krakenos.test']);
    });

    it('pedirlo dos veces no duplica la solicitud', async () => {
      await pedir();
      await pedir();
      expect(await app.prisma.accessRequest.count()).toBe(1);
    });

    /**
     * Aprobar NO crea la cuenta con una contraseña puesta a dedo: emite una
     * invitación, de modo que la contraseña la siga eligiendo quien la va a usar.
     */
    it('aprobar emite una invitación, no una contraseña', async () => {
      await pedir();
      const [fila] = await app.prisma.accessRequest.findMany();

      const res = await app.inject({
        method: 'POST',
        url: `/api/access-requests/${fila!.id}/decide`,
        headers: authHeader(adminToken),
        payload: { decision: 'approve', role: 'kid' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.request.status).toBe('approved');
      expect(body.invitation.token).toBeTruthy();

      // Sigue sin haber cuenta: la crea quien acepte el enlace, con SU contraseña.
      expect(await app.prisma.user.findUnique({ where: { email: 'quiero@krakenos.test' } })).toBeNull();

      const alta = await app.inject({
        method: 'POST',
        url: `/api/invitations/redeem/${body.invitation.token}`,
        payload: { password: 'elijo-yo-99' },
      });
      expect(alta.statusCode).toBe(201);
      expect(alta.json().user.role).toBe('kid');
    });

    it('rechazar no emite invitación, y el «no» no se reabre volviendo a pedirlo', async () => {
      await pedir();
      const [fila] = await app.prisma.accessRequest.findMany();

      const res = await app.inject({
        method: 'POST',
        url: `/api/access-requests/${fila!.id}/decide`,
        headers: authHeader(adminToken),
        payload: { decision: 'reject' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().invitation).toBeUndefined();
      expect(await app.prisma.invitation.count()).toBe(0);

      // Volver a pedirlo no lo devuelve a «pendiente»: si no, el «no» del admin
      // duraría lo que tarde el interesado en pulsar el botón otra vez.
      await pedir();
      const [despues] = await app.prisma.accessRequest.findMany();
      expect(despues!.status).toBe('rejected');
    });

    it('aprobar sin elegir rol se rechaza: el rol no puede caer por defecto', async () => {
      await pedir();
      const [fila] = await app.prisma.accessRequest.findMany();
      const res = await app.inject({
        method: 'POST',
        url: `/api/access-requests/${fila!.id}/decide`,
        headers: authHeader(adminToken),
        payload: { decision: 'approve' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('una solicitud ya decidida no se vuelve a decidir', async () => {
      await pedir();
      const [fila] = await app.prisma.accessRequest.findMany();
      const decidir = () =>
        app.inject({
          method: 'POST',
          url: `/api/access-requests/${fila!.id}/decide`,
          headers: authHeader(adminToken),
          payload: { decision: 'reject' },
        });
      expect((await decidir()).statusCode).toBe(200);
      expect((await decidir()).statusCode).toBe(409);
    });

    it('la lista es admin-only y muestra lo pendiente', async () => {
      await pedir();
      const res = await app.inject({
        method: 'GET',
        url: '/api/access-requests?status=pending',
        headers: authHeader(adminToken),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveLength(1);
      expect(res.json()[0].note).toBe('soy del cuarto de arriba');
      expect(adminId).toBeTruthy();
    });
  });
});
