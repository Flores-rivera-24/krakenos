import type { SetupInitRequest } from '@krakenos/types';
import { Prisma } from '@prisma/client';
import bcrypt from 'bcrypt';
import type { FastifyPluginAsync } from 'fastify';
import { sendSession } from '../../auth/session-cookie.js';
import { AuthService } from '../auth/auth.service.js';
import { setupToken } from './setup-token.js';
import { setupInitSchema, setupStatusSchema } from './setup.schemas.js';

/** ¿El error es una violación de unicidad de Prisma (P2002)? */
function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/** Intentos de `/setup/init` por minuto y por IP (público hasta crear el admin). */
const SETUP_INIT_RATE_LIMIT = 5;

/**
 * Candado de "el primer admin ya se reclamó" (US-53).
 *
 * Es una clave de `Setting` **dedicada**, y eso es el punto: antes el candado era
 * el propio `homeName`, que además es un **dato** del usuario. Una instalación que
 * se quedaba sin usuarios (reset manual, restauración, borrado) conservaba su
 * `homeName`, así que la transacción de `/init` chocaba con él para siempre y el
 * `catch` lo traducía a «El sistema ya está configurado» — con cero usuarios y sin
 * nadie con quien iniciar sesión. Bloqueo permanente y con un mensaje que mentía.
 *
 * Al ser una clave propia sin valor para nadie, se puede **limpiar cuando no queda
 * ningún usuario** (`clearStaleSetupClaim`, al arrancar) sin tirar datos de nadie.
 */
const SETUP_CLAIM_KEY = 'setup.claimed';

/** Prisma mínimo que necesita la limpieza del candado (facilita el test). */
interface SetupClaimPrisma {
  user: { count(): Promise<number> };
  setting: { deleteMany(args: { where: { key: string } }): Promise<{ count: number }> };
}

/**
 * Suelta el candado del primer admin si la instalación se quedó **sin usuarios**.
 *
 * Se llama al arrancar, antes de aceptar peticiones: es el único momento sin
 * concurrencia, así que soltarlo aquí no reabre la carrera que el candado cierra
 * (durante el `/init` el candado sigue siendo la única puerta). Devuelve si había
 * un candado obsoleto que soltar.
 */
export async function clearStaleSetupClaim(prisma: SetupClaimPrisma): Promise<boolean> {
  if ((await prisma.user.count()) > 0) return false;
  const { count } = await prisma.setting.deleteMany({ where: { key: SETUP_CLAIM_KEY } });
  return count > 0;
}

export const setupRoutes: FastifyPluginAsync = async (app) => {
  const auth = new AuthService(app);

  app.get('/status', { schema: setupStatusSchema }, async () => {
    const count = await app.prisma.user.count();
    return { needsSetup: count === 0, requiresToken: setupToken.isActive() };
  });

  // `/init` es público mientras no haya admin: se limita por IP para que nadie
  // pueda martillearlo (carrera por el primer admin / DoS) antes de la configuración (US-88).
  app.post<{ Body: SetupInitRequest }>(
    '/init',
    {
      schema: setupInitSchema,
      config: { rateLimit: { max: SETUP_INIT_RATE_LIMIT, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const { homeName, email, displayName, password } = req.body;

      // Camino rápido: instalación ya configurada.
      if ((await app.prisma.user.count()) > 0) {
        return reply.code(409).send({
          code: 'SETUP_ALREADY_DONE',
          message: 'El sistema ya está configurado',
        });
      }

      // Token de configuración out-of-band (US-81, F10): si el agente generó un
      // token al arrancar (impreso en el log), `/init` lo exige. Cierra la ventana
      // de "first-boot" en la que el primer cliente reclamaba el admin sin prueba
      // de acceso al servidor.
      if (setupToken.isActive() && !setupToken.verify(req.body.setupToken ?? '')) {
        app.audit({ action: 'setup.init_denied', ip: req.ip });
        return reply.code(401).send({
          code: 'SETUP_TOKEN_INVALID',
          message: 'Token de configuración inválido o ausente',
        });
      }

      const passwordHash = await bcrypt.hash(password, 12);

      try {
        // Atómico contra carreras (US-53): el admin y el candado se crean en una sola
        // transacción. `Setting.key` es PK, así que dos `/init` en paralelo no pueden
        // crear ambos el candado: el segundo viola la unicidad y la transacción entera
        // se revierte (no queda un admin huérfano). El `email` único da la misma
        // garantía si ambos usan el mismo correo. El perdedor recibe un 409 determinista.
        //
        // ⚠️ `homeName` va por `upsert` y NO hace de candado: es un dato, sobrevive al
        // borrado de los usuarios y como candado dejaba la instalación imposible de
        // configurar para siempre (ver `SETUP_CLAIM_KEY`).
        await app.prisma.$transaction([
          app.prisma.user.create({ data: { email, displayName, passwordHash, role: 'admin' } }),
          app.prisma.setting.create({ data: { key: SETUP_CLAIM_KEY, value: 'true' } }),
          app.prisma.setting.upsert({
            where: { key: 'homeName' },
            create: { key: 'homeName', value: homeName },
            update: { value: homeName },
          }),
        ]);
      } catch (err) {
        if (isUniqueViolation(err)) {
          // Con usuarios, es la carrera de US-53: alguien ganó el primer admin.
          if ((await app.prisma.user.count()) > 0) {
            return reply.code(409).send({
              code: 'SETUP_ALREADY_DONE',
              message: 'El sistema ya está configurado',
            });
          }
          // Sin usuarios, el candado quedó de un arranque anterior (los usuarios se
          // borraron con el agente vivo). No se suelta aquí —sería reabrir la carrera
          // justo en la ventana que protege—: se suelta al arrancar. Decirlo es lo
          // único honesto; «ya está configurado» sería falso y sin salida.
          return reply.code(409).send({
            code: 'SETUP_LOCK_STALE',
            message:
              'La configuración quedó bloqueada por un intento anterior. Reinicia el agente y vuelve a intentarlo.',
          });
        }
        throw err;
      }

      // Admin creado: el token de setup ya no sirve (de un solo uso).
      setupToken.clear();

      // Inicia sesión inmediatamente: refresh en cookie httpOnly, access en el cuerpo (US-91).
      const session = await auth.login(email, password);
      app.audit({ action: 'setup.init', userId: session.user.id, ip: req.ip });
      return sendSession(reply, session);
    },
  );
};
