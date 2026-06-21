import type { WebAuthnCredentialInfo } from '@krakenos/types';
import type { PrismaClient, WebAuthnCredential } from '@prisma/client';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';

/** Error de dominio WebAuthn con código estable, mapeable a HTTP por la ruta. */
export class WebAuthnError extends Error {
  constructor(message: string) {
    super(message);
  }
}

/** Configuración del Relying Party. */
export interface WebAuthnConfig {
  rpName: string;
  /** Dominio sin protocolo (p. ej. `krakenos.local`). */
  rpID: string;
  /** Origen completo (p. ej. `https://krakenos.local:3001`). */
  origin: string;
}

/** ¿`host` es una dirección IPv4? (no válida como RP ID en los navegadores). */
function isIpv4(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

/**
 * Avisos de configuración de WebAuthn al arrancar (despliegue recomendado:
 * **Escenario A** — TLS nativo del agente + hostname). Devuelve la lista de
 * problemas que impedirían usar passkeys; vacía si la config es correcta.
 * `localhost` es la única excepción al requisito de contexto seguro (HTTPS).
 */
export function webauthnConfigWarnings(cfg: {
  rpID: string;
  origin: string;
  isProd: boolean;
  /** El agente sirve TLS directamente, o lo termina un proxy de confianza. */
  secureContext: boolean;
}): string[] {
  const warnings: string[] = [];
  const isLocalhost = cfg.rpID === 'localhost';
  const secure = isLocalhost || cfg.origin.startsWith('https://') || cfg.secureContext;

  if (isIpv4(cfg.rpID)) {
    warnings.push(
      `WEBAUTHN_RP_ID="${cfg.rpID}" es una IP: los navegadores rechazan passkeys por IP. Usa un hostname (p. ej. krakenos.local).`,
    );
  }
  if (!secure) {
    warnings.push(
      'WebAuthn exige contexto seguro (HTTPS) salvo en localhost. Activa HTTPS_ENABLED (Escenario A) o termina TLS en un proxy de confianza (TRUST_PROXY).',
    );
  }
  if (cfg.isProd && isLocalhost) {
    warnings.push(
      'WEBAUTHN_RP_ID sigue en "localhost" en producción: ajústalo al hostname real (WEBAUTHN_RP_ID/WEBAUTHN_ORIGIN) para poder usar passkeys.',
    );
  }
  return warnings;
}

/** Usuario mínimo necesario para las ceremonias WebAuthn. */
interface WebAuthnUser {
  id: string;
  email: string;
  displayName: string;
}

/** Validez del desafío temporal: 5 minutos. */
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

/** Proyecta la fila de la DB al DTO público (sin clave pública ni counter). */
function toInfo(c: WebAuthnCredential): WebAuthnCredentialInfo {
  return {
    id: c.id,
    name: c.name,
    deviceType: c.deviceType,
    backedUp: c.backedUp,
    createdAt: c.createdAt.toISOString(),
    lastUsedAt: c.lastUsedAt ? c.lastUsedAt.toISOString() : null,
  };
}

/**
 * Lógica de registro/autenticación de passkeys (WebAuthn, US-50). El transporte
 * criptográfico lo provee `@simplewebauthn/server`; aquí persistimos credenciales
 * y el desafío temporal en `User`.
 */
export class WebAuthnService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: WebAuthnConfig,
  ) {}

  /** ¿El usuario tiene al menos una passkey registrada? (decide si exigir 2FA). */
  async hasCredentials(userId: string): Promise<boolean> {
    const count = await this.prisma.webAuthnCredential.count({ where: { userId } });
    return count > 0;
  }

  async listCredentials(userId: string): Promise<WebAuthnCredentialInfo[]> {
    const rows = await this.prisma.webAuthnCredential.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toInfo);
  }

  async renameCredential(
    userId: string,
    id: string,
    name: string,
  ): Promise<WebAuthnCredentialInfo | null> {
    const row = await this.prisma.webAuthnCredential.findUnique({ where: { id } });
    if (!row || row.userId !== userId) return null;
    const updated = await this.prisma.webAuthnCredential.update({ where: { id }, data: { name } });
    return toInfo(updated);
  }

  /** Elimina una passkey del usuario. La contraseña sigue siendo el primer factor. */
  async deleteCredential(userId: string, id: string): Promise<boolean> {
    const row = await this.prisma.webAuthnCredential.findUnique({ where: { id } });
    if (!row || row.userId !== userId) return false;
    await this.prisma.webAuthnCredential.delete({ where: { id } });
    return true;
  }

  async generateRegistrationOptions(
    user: WebAuthnUser,
  ): Promise<PublicKeyCredentialCreationOptionsJSON> {
    const existing = await this.prisma.webAuthnCredential.findMany({ where: { userId: user.id } });
    const options = await generateRegistrationOptions({
      rpName: this.config.rpName,
      rpID: this.config.rpID,
      userName: user.email,
      userDisplayName: user.displayName,
      // Evita registrar dos veces el mismo autenticador.
      excludeCredentials: existing.map((c) => ({ id: c.credentialId })),
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
    });
    await this.saveChallenge(user.id, options.challenge);
    return options;
  }

  async verifyRegistration(
    user: WebAuthnUser,
    response: RegistrationResponseJSON,
    name: string,
  ): Promise<WebAuthnCredentialInfo> {
    const challenge = await this.consumeChallengeOrThrow(user.id);
    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: this.config.origin,
      expectedRPID: this.config.rpID,
    });
    if (!verification.verified || !verification.registrationInfo) {
      throw new WebAuthnError('No se pudo verificar el registro de la passkey');
    }
    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
    const created = await this.prisma.webAuthnCredential.create({
      data: {
        userId: user.id,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey),
        counter: credential.counter,
        deviceType: credentialDeviceType,
        backedUp: credentialBackedUp,
        name,
      },
    });
    await this.clearChallenge(user.id);
    return toInfo(created);
  }

  /** Devuelve `null` si el usuario no tiene passkeys registradas. */
  async generateAuthenticationOptions(
    user: WebAuthnUser,
  ): Promise<PublicKeyCredentialRequestOptionsJSON | null> {
    const existing = await this.prisma.webAuthnCredential.findMany({ where: { userId: user.id } });
    if (existing.length === 0) return null;
    const options = await generateAuthenticationOptions({
      rpID: this.config.rpID,
      allowCredentials: existing.map((c) => ({ id: c.credentialId })),
      userVerification: 'preferred',
    });
    await this.saveChallenge(user.id, options.challenge);
    return options;
  }

  async verifyAuthentication(user: WebAuthnUser, response: AuthenticationResponseJSON): Promise<void> {
    const challenge = await this.consumeChallengeOrThrow(user.id);
    const credential = await this.prisma.webAuthnCredential.findUnique({
      where: { credentialId: response.id },
    });
    if (!credential || credential.userId !== user.id) {
      throw new WebAuthnError('Passkey no reconocida');
    }
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: this.config.origin,
      expectedRPID: this.config.rpID,
      credential: {
        id: credential.credentialId,
        // Prisma devuelve `Buffer` (Uint8Array<ArrayBufferLike>); la librería espera
        // un Uint8Array respaldado por ArrayBuffer → copia.
        publicKey: new Uint8Array(credential.publicKey),
        counter: credential.counter,
      },
    });
    if (!verification.verified) {
      throw new WebAuthnError('No se pudo verificar la passkey');
    }
    await this.prisma.webAuthnCredential.update({
      where: { id: credential.id },
      data: { counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date() },
    });
    await this.clearChallenge(user.id);
  }

  private async saveChallenge(userId: string, challenge: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        webAuthnChallenge: challenge,
        webAuthnChallengeExp: new Date(Date.now() + CHALLENGE_TTL_MS),
      },
    });
  }

  /** Lee el desafío vigente o lanza si falta/expiró. No lo borra (eso al verificar OK). */
  private async consumeChallengeOrThrow(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (
      !user?.webAuthnChallenge ||
      !user.webAuthnChallengeExp ||
      user.webAuthnChallengeExp < new Date()
    ) {
      throw new WebAuthnError('El desafío ha expirado o no existe');
    }
    return user.webAuthnChallenge;
  }

  private async clearChallenge(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { webAuthnChallenge: null, webAuthnChallengeExp: null },
    });
  }
}
