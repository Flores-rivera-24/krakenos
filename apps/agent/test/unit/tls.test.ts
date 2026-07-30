import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  TLS_WARN_DAYS,
  certificateHealth,
  classifyCertificateSource,
  disabledWithoutTls,
  readCertificateValidity,
} from '../../src/system/tls.js';

/**
 * Lógica del certificado TLS (US-241). Los certificados se generan **de verdad**
 * con openssl en un temporal: un fixture PEM pegado a mano caduca solo y
 * convertiría este test en una bomba de reloj como la que US-240 tuvo que
 * desactivar en las copias automáticas.
 */

/** Genera un certificado autofirmado con la validez pedida. */
function generarCert(dias: number, cn = 'krakenos.local'): string {
  const dir = mkdtempSync(join(tmpdir(), 'krakenos-tls-'));
  const cert = join(dir, 'cert.pem');
  execFileSync(
    'openssl',
    [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', join(dir, 'key.pem'),
      '-out', cert,
      '-days', String(dias),
      '-subj', `/CN=${cn}`,
    ],
    { stdio: 'pipe' }, // openssl escupe su barra de progreso por stderr
  );
  return readFileSync(cert, 'utf8');
}

describe('readCertificateValidity (US-241)', () => {
  it('extrae la ventana de validez de un certificado real', () => {
    const validity = readCertificateValidity(generarCert(30));
    expect(validity).not.toBeNull();
    const dias = Math.round(
      (validity!.notAfter.getTime() - validity!.notBefore.getTime()) / 86_400_000,
    );
    expect(dias).toBe(30);
    expect(validity!.subject).toContain('krakenos.local');
  });

  it('devuelve null con basura, en vez de tumbar el arranque', () => {
    // El servidor ya está sirviendo con lo que tenga cargado: un PEM ilegible no
    // puede ser motivo para caerse.
    expect(readCertificateValidity('')).toBeNull();
    expect(readCertificateValidity('-----BEGIN CERTIFICATE-----\nnope\n-----END CERTIFICATE-----')).toBeNull();
    expect(readCertificateValidity('cualquier cosa')).toBeNull();
  });
});

describe('classifyCertificateSource (US-241)', () => {
  it('reconoce un certificado de Tailscale por su nombre', () => {
    const validity = readCertificateValidity(generarCert(90, 'casa.tailnet-abc.ts.net'));
    expect(classifyCertificateSource(validity!)).toBe('tailscale');
  });

  it('reconoce un autofirmado: nadie por encima lo avala', () => {
    const validity = readCertificateValidity(generarCert(825));
    expect(classifyCertificateSource(validity!)).toBe('self-signed');
  });

  it('no adivina cuando no sabe', () => {
    expect(
      classifyCertificateSource({
        notBefore: new Date(),
        notAfter: new Date(),
        subject: 'CN=casa.example.com',
        issuer: 'CN=Una CA de empresa',
      }),
    ).toBe('unknown');
  });
});

describe('certificateHealth (US-241)', () => {
  const ahora = new Date('2026-07-30T12:00:00.000Z');
  const enDias = (d: number) => new Date(ahora.getTime() + d * 86_400_000);

  it('cuenta los días que quedan', () => {
    expect(certificateHealth(enDias(60), ahora).daysLeft).toBe(60);
    expect(certificateHealth(enDias(60), ahora).expiring).toBe(false);
    expect(certificateHealth(enDias(60), ahora).expired).toBe(false);
  });

  it('avisa dentro de la ventana', () => {
    const salud = certificateHealth(enDias(TLS_WARN_DAYS - 1), ahora);
    expect(salud.expiring).toBe(true);
    expect(salud.expired).toBe(false);
  });

  it('redondea hacia ABAJO: 0,8 días no son «1 día»', () => {
    // Redondear hacia arriba daría una tranquilidad que no toca.
    expect(certificateHealth(new Date(ahora.getTime() + 0.8 * 86_400_000), ahora).daysLeft).toBe(0);
  });

  it('un certificado caducado también avisa, y se marca caducado', () => {
    const salud = certificateHealth(enDias(-3), ahora);
    expect(salud.expired).toBe(true);
    expect(salud.expiring).toBe(true);
    expect(salud.daysLeft).toBeLessThan(0);
  });

  it('el límite exacto de la ventana cuenta como aviso', () => {
    expect(certificateHealth(enDias(TLS_WARN_DAYS), ahora).expiring).toBe(true);
    expect(certificateHealth(enDias(TLS_WARN_DAYS + 1), ahora).expiring).toBe(false);
  });
});

describe('disabledWithoutTls (US-241)', () => {
  it('sin contexto seguro se caen PWA, push y passkeys', () => {
    expect(disabledWithoutTls(false)).toEqual(['pwa', 'push', 'passkeys']);
  });

  it('con contexto seguro no falta nada', () => {
    expect(disabledWithoutTls(true)).toEqual([]);
  });
});
