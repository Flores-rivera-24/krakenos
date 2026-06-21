import type { PrismaClient } from '@prisma/client';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  WebAuthnError,
  WebAuthnService,
  webauthnConfigWarnings,
} from '../../src/webauthn/webauthn.service.js';

vi.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: vi.fn(),
  verifyRegistrationResponse: vi.fn(),
  generateAuthenticationOptions: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
}));

const CONFIG = { rpName: 'KrakenOS', rpID: 'localhost', origin: 'http://localhost:5173' };
const USER = { id: 'u1', email: 'a@b.c', displayName: 'Ada' };

interface PrismaMock {
  webAuthnCredential: {
    count: Mock;
    findMany: Mock;
    findUnique: Mock;
    create: Mock;
    update: Mock;
    delete: Mock;
  };
  user: { findUnique: Mock; update: Mock };
}

function makePrisma(): PrismaMock {
  return {
    webAuthnCredential: {
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn(),
    },
    user: { findUnique: vi.fn(), update: vi.fn().mockResolvedValue({}) },
  };
}

function makeService(prisma: PrismaMock): WebAuthnService {
  return new WebAuthnService(prisma as unknown as PrismaClient, CONFIG);
}

describe('WebAuthnService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('generateRegistrationOptions guarda el challenge en el User', async () => {
    (generateRegistrationOptions as Mock).mockResolvedValue({ challenge: 'CHAL', rp: {} });
    const prisma = makePrisma();
    await makeService(prisma).generateRegistrationOptions(USER);

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u1' },
        data: expect.objectContaining({ webAuthnChallenge: 'CHAL' }),
      }),
    );
  });

  it('verifyRegistration rechaza si el challenge expiró', async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue({
      webAuthnChallenge: 'X',
      webAuthnChallengeExp: new Date(Date.now() - 1000),
    });

    await expect(
      makeService(prisma).verifyRegistration(USER, {} as never, 'iPhone'),
    ).rejects.toBeInstanceOf(WebAuthnError);
    expect(verifyRegistrationResponse).not.toHaveBeenCalled();
  });

  it('verifyRegistration crea la credencial y limpia el challenge si verifica', async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue({
      webAuthnChallenge: 'X',
      webAuthnChallengeExp: new Date(Date.now() + 60_000),
    });
    (verifyRegistrationResponse as Mock).mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: { id: 'cred1', publicKey: new Uint8Array([1, 2, 3]), counter: 0 },
        credentialDeviceType: 'singleDevice',
        credentialBackedUp: false,
      },
    });
    prisma.webAuthnCredential.create.mockResolvedValue({
      id: 'k1',
      name: 'iPhone',
      deviceType: 'singleDevice',
      backedUp: false,
      createdAt: new Date(),
      lastUsedAt: null,
    });

    const info = await makeService(prisma).verifyRegistration(USER, {} as never, 'iPhone');

    expect(prisma.webAuthnCredential.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ credentialId: 'cred1', name: 'iPhone' }),
      }),
    );
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { webAuthnChallenge: null, webAuthnChallengeExp: null } }),
    );
    expect(info.name).toBe('iPhone');
  });

  it('generateAuthenticationOptions devuelve null si el usuario no tiene passkeys', async () => {
    const prisma = makePrisma(); // findMany → []
    const result = await makeService(prisma).generateAuthenticationOptions(USER);
    expect(result).toBeNull();
    expect(generateAuthenticationOptions).not.toHaveBeenCalled();
  });

  it('verifyAuthentication actualiza counter y lastUsedAt', async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue({
      webAuthnChallenge: 'X',
      webAuthnChallengeExp: new Date(Date.now() + 60_000),
    });
    prisma.webAuthnCredential.findUnique.mockResolvedValue({
      id: 'k1',
      userId: 'u1',
      credentialId: 'cred1',
      publicKey: Buffer.from([1, 2, 3]),
      counter: 0,
    });
    (verifyAuthenticationResponse as Mock).mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 5 },
    });

    await makeService(prisma).verifyAuthentication(USER, { id: 'cred1' } as never);

    expect(prisma.webAuthnCredential.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'k1' },
        data: expect.objectContaining({ counter: 5, lastUsedAt: expect.any(Date) }),
      }),
    );
  });
});

describe('webauthnConfigWarnings', () => {
  it('no avisa en dev (localhost, sin HTTPS)', () => {
    expect(
      webauthnConfigWarnings({
        rpID: 'localhost',
        origin: 'http://localhost:5173',
        isProd: false,
        secureContext: false,
      }),
    ).toEqual([]);
  });

  it('no avisa con el Escenario A bien configurado', () => {
    expect(
      webauthnConfigWarnings({
        rpID: 'krakenos.local',
        origin: 'https://krakenos.local:3001',
        isProd: true,
        secureContext: true,
      }),
    ).toEqual([]);
  });

  it('avisa si RP_ID es una IP', () => {
    const warnings = webauthnConfigWarnings({
      rpID: '192.168.1.10',
      origin: 'https://192.168.1.10:3001',
      isProd: true,
      secureContext: true,
    });
    expect(warnings.some((w) => w.includes('IP'))).toBe(true);
  });

  it('avisa si no hay contexto seguro fuera de localhost', () => {
    const warnings = webauthnConfigWarnings({
      rpID: 'krakenos.local',
      origin: 'http://krakenos.local:3001',
      isProd: true,
      secureContext: false,
    });
    expect(warnings.some((w) => w.includes('HTTPS'))).toBe(true);
  });

  it('avisa si en producción sigue en localhost', () => {
    const warnings = webauthnConfigWarnings({
      rpID: 'localhost',
      origin: 'http://localhost:5173',
      isProd: true,
      secureContext: false,
    });
    expect(warnings.some((w) => w.includes('localhost'))).toBe(true);
  });
});
