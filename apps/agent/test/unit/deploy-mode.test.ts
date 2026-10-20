import { describe, expect, it } from 'vitest';
import { DEPLOY_MODES } from '@krakenos/types';
import {
  canAutoUpdate,
  detectDeployMode,
  DOCKER_UPDATE_COMMAND,
} from '../../src/system/deploy-mode.js';
import { updateApplySchema, updatePlanSchema } from '../../src/modules/system/system.schemas.js';

describe('detectDeployMode', () => {
  it('respeta el override explícito por env', () => {
    expect(
      detectDeployMode({ envOverride: 'docker', fileExists: () => false, platform: 'linux' }),
    ).toBe('docker');
    expect(
      detectDeployMode({ envOverride: 'systemd', fileExists: () => true, platform: 'linux' }),
    ).toBe('systemd');
    expect(
      detectDeployMode({ envOverride: 'DOCKER', fileExists: () => false, platform: 'linux' }),
    ).toBe('docker');
  });

  it('override desconocido se ignora y cae a la detección por fichero', () => {
    expect(
      detectDeployMode({ envOverride: 'k8s', fileExists: () => true, platform: 'linux' }),
    ).toBe('docker');
    expect(detectDeployMode({ envOverride: '', fileExists: () => false, platform: 'linux' })).toBe(
      'systemd',
    );
  });

  it('detecta docker por /.dockerenv', () => {
    expect(detectDeployMode({ fileExists: (p) => p === '/.dockerenv', platform: 'linux' })).toBe(
      'docker',
    );
  });

  it('por defecto systemd (bare-metal)', () => {
    expect(detectDeployMode({ fileExists: () => false, platform: 'linux' })).toBe('systemd');
  });

  it('el comando docker sugerido es el de compose', () => {
    expect(DOCKER_UPDATE_COMMAND).toContain('docker compose pull');
  });

  describe('modos nuevos (US-280)', () => {
    it('en Windows el default es windows-service y NUNCA systemd', () => {
      expect(detectDeployMode({ platform: 'win32', fileExists: () => false })).toBe(
        'windows-service',
      );
      // ni aunque un /.dockerenv de ficción exista
      expect(detectDeployMode({ platform: 'win32', fileExists: () => true })).toBe(
        'windows-service',
      );
    });

    it('un override systemd en Windows se ignora (no puede existir); los demás se respetan', () => {
      expect(detectDeployMode({ platform: 'win32', envOverride: 'systemd' })).toBe(
        'windows-service',
      );
      expect(detectDeployMode({ platform: 'win32', envOverride: 'docker' })).toBe('docker');
      expect(detectDeployMode({ platform: 'win32', envOverride: 'package' })).toBe('package');
    });

    it('package solo se alcanza por override (el .deb lo fija)', () => {
      expect(detectDeployMode({ platform: 'linux', envOverride: 'package' })).toBe('package');
      expect(detectDeployMode({ platform: 'linux', envOverride: 'Windows-Service' })).toBe(
        'windows-service',
      );
      expect(detectDeployMode({ platform: 'linux', fileExists: () => false })).toBe('systemd');
    });

    it('solo systemd se auto-actualiza', () => {
      const auto = DEPLOY_MODES.filter((m) => canAutoUpdate(m));
      expect(auto).toEqual(['systemd']);
    });

    it('los schemas de respuesta enumeran EXACTAMENTE los modos del contrato', () => {
      const planMode = updatePlanSchema.response[200].properties.mode.enum;
      const applyMode = updateApplySchema.response[200].properties.mode.enum;
      expect(planMode).toEqual([...DEPLOY_MODES]);
      expect(applyMode).toEqual([...DEPLOY_MODES]);
      expect(DEPLOY_MODES).toHaveLength(4);
    });
  });
});
