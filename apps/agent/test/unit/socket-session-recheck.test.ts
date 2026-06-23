import type { AccessTokenClaims } from '@krakenos/types';
import { describe, expect, it, vi } from 'vitest';
import { isSocketTokenValid, sweepStaleSockets } from '../../src/plugins/socketio.js';

const accessClaims = (): AccessTokenClaims => ({
  sub: 'u1',
  email: 'u@krakenos.test',
  role: 'admin',
  type: 'access',
});

describe('re-verificación de sesión de Socket.io (US-80, F7)', () => {
  describe('isSocketTokenValid', () => {
    it('acepta un access token que verifica', () => {
      expect(isSocketTokenValid('tok', () => accessClaims())).toBe(true);
    });

    it('rechaza si la verificación lanza (expirado / clave retirada)', () => {
      expect(
        isSocketTokenValid('tok', () => {
          throw new Error('expired');
        }),
      ).toBe(false);
    });

    it('rechaza un token cuyo type no es access', () => {
      expect(isSocketTokenValid('tok', () => ({ ...accessClaims(), type: 'refresh' }) as AccessTokenClaims)).toBe(false);
    });
  });

  describe('sweepStaleSockets', () => {
    function fakeSocket(token: string) {
      return { data: { token }, emit: vi.fn(), disconnect: vi.fn() };
    }

    it('corta solo los sockets cuyo token ya no es válido y avisa con auth:expired', () => {
      const valid = fakeSocket('good');
      const stale = fakeSocket('bad');
      const verify = (t: string): AccessTokenClaims => {
        if (t === 'bad') throw new Error('expired');
        return accessClaims();
      };

      const cut = sweepStaleSockets([valid, stale], verify);

      expect(cut).toBe(1);
      expect(stale.emit).toHaveBeenCalledWith('auth:expired');
      expect(stale.disconnect).toHaveBeenCalledWith(true);
      expect(valid.emit).not.toHaveBeenCalled();
      expect(valid.disconnect).not.toHaveBeenCalled();
    });

    it('no corta nada si todos los tokens son válidos', () => {
      const a = fakeSocket('a');
      const b = fakeSocket('b');
      expect(sweepStaleSockets([a, b], () => accessClaims())).toBe(0);
      expect(a.disconnect).not.toHaveBeenCalled();
      expect(b.disconnect).not.toHaveBeenCalled();
    });
  });
});
