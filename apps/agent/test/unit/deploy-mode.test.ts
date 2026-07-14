import { describe, expect, it } from 'vitest';
import { detectDeployMode, DOCKER_UPDATE_COMMAND } from '../../src/system/deploy-mode.js';

describe('detectDeployMode', () => {
  it('respeta el override explícito por env', () => {
    expect(detectDeployMode({ envOverride: 'docker', fileExists: () => false })).toBe('docker');
    expect(detectDeployMode({ envOverride: 'systemd', fileExists: () => true })).toBe('systemd');
    expect(detectDeployMode({ envOverride: 'DOCKER', fileExists: () => false })).toBe('docker');
  });

  it('override desconocido se ignora y cae a la detección por fichero', () => {
    expect(detectDeployMode({ envOverride: 'k8s', fileExists: () => true })).toBe('docker');
    expect(detectDeployMode({ envOverride: '', fileExists: () => false })).toBe('systemd');
  });

  it('detecta docker por /.dockerenv', () => {
    expect(detectDeployMode({ fileExists: (p) => p === '/.dockerenv' })).toBe('docker');
  });

  it('por defecto systemd (bare-metal)', () => {
    expect(detectDeployMode({ fileExists: () => false })).toBe('systemd');
  });

  it('el comando docker sugerido es el de compose', () => {
    expect(DOCKER_UPDATE_COMMAND).toContain('docker compose pull');
  });
});
