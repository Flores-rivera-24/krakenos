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
  webAuthnChallenge: {
    create: Mock;
    findFirst: Mock;
    delete: Mock;
    deleteMany: Mock;
  };
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
    webAuthnChallenge: {
      create: vi.fn().mockResolvedValue({}),
      findFirst: vi.fn(),
      delete: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  };
}

function makeService(prisma: PrismaMock): WebAuthnService {
  return new WebAuthnService(prisma as unknown as PrismaClient, CONFIG);
}

/** Respuesta WebAuthn cuyo clientDataJSON codifica `challenge` (base64url). */
function responseWith(challenge: string, extra: Record<string, unknown> = {}): never {
  const clientDataJSON = Buffer.from(JSON.stringify({ challenge })).toString('base64url');
  return { response: { clientDataJSON }, ...extra } as never;
}

/** Fila de desafío activa para el mock de `findFirst`. */
function challengeRow(challenge: string, type: string) {
  return { id: 'ch1', userId: 'u1', type, challenge, expiresAt: new Date(Date.now() + 60_000) };
}

describe('WebAuthnService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('generateRegistrationOptions guarda el challenge en una fila de ceremonia', async () => {
    (generateRegistrationOptions as Mock).mockResolvedValue({ challenge: 'CHAL', rp: {} });
    const prisma = makePrisma();
    await makeService(prisma).generateRegistrationOptions(USER);

    expect(prisma.webAuthnChallenge.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: 'u1', type: 'register', challenge: 'CHAL' }),
      }),
    );
  });

  it('verifyRegistration rechaza si el challenge no existe o expiró', async () => {
    const prisma = makePrisma();
    prisma.webAuthnChallenge.findFirst.mockResolvedValue(null);

    await expect(
      makeService(prisma).verifyRegistration(USER, responseWith('X'), 'iPhone'),
    ).rejects.toBeInstanceOf(WebAuthnError);
    expect(verifyRegistrationResponse).not.toHaveBeenCalled();
  });

  it('verifyRegistration crea la credencial y consume el challenge si verifica', async () => {
    const prisma = makePrisma();
    prisma.webAuthnChallenge.findFirst.mockResolvedValue(challengeRow('X', 'register'));
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

    const info = await makeService(prisma).verifyRegistration(USER, responseWith('X'), 'iPhone');

    expect(prisma.webAuthnCredential.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ credentialId: 'cred1', name: 'iPhone' }),
      }),
    );
    expect(prisma.webAuthnChallenge.delete).toHaveBeenCalledWith({ where: { id: 'ch1' } });
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
    prisma.webAuthnChallenge.findFirst.mockResolvedValue(challengeRow('X', 'authenticate'));
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

    await makeService(prisma).verifyAuthentication(USER, responseWith('X', { id: 'cred1' }));

    expect(prisma.webAuthnCredential.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'k1' },
        data: expect.objectContaining({ counter: 5, lastUsedAt: expect.any(Date) }),
      }),
    );
  });

  it('consume el challenge ANTES de verificar, aunque la verificación falle (US-58)', async () => {
    const prisma = makePrisma();
    prisma.webAuthnChallenge.findFirst.mockResolvedValue(challengeRow('X', 'authenticate'));
    // Credencial no reconocida → la verificación fallará tras consumir el challenge.
    prisma.webAuthnCredential.findUnique.mockResolvedValue(null);

    await expect(
      makeService(prisma).verifyAuthentication(USER, responseWith('X', { id: 'cred-x' })),
    ).rejects.toBeInstanceOf(WebAuthnError);

    // El challenge se invalidó pese al fallo → de un solo uso, no replayable.
    expect(prisma.webAuthnChallenge.delete).toHaveBeenCalledWith({ where: { id: 'ch1' } });
    // Y nunca se llegó a verificar la aserción con un challenge ya consumido.
    expect(verifyAuthenticationResponse).not.toHaveBeenCalled();
  });

  it('soporta ceremonias concurrentes: consume el desafío concreto que presenta la respuesta (US-82)', async () => {
    const prisma = makePrisma();
    // Dos ceremonias en curso; la respuesta presenta el challenge "B".
    prisma.webAuthnChallenge.findFirst.mockImplementation(({ where }: { where: { challenge: string } }) =>
      where.challenge === 'B' ? Promise.resolve({ ...challengeRow('B', 'authenticate'), id: 'chB' }) : Promise.resolve(null),
    );
    prisma.webAuthnCredential.findUnique.mockResolvedValue({
      id: 'k1',
      userId: 'u1',
      credentialId: 'cred1',
      publicKey: Buffer.from([1, 2, 3]),
      counter: 0,
    });
    (verifyAuthenticationResponse as Mock).mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 1 },
    });

    await makeService(prisma).verifyAuthentication(USER, responseWith('B', { id: 'cred1' }));

    // Se consumió exactamente la fila del challenge presentado, no otra.
    expect(prisma.webAuthnChallenge.delete).toHaveBeenCalledWith({ where: { id: 'chB' } });
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
