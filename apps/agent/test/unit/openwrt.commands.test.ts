import { describe, expect, it } from 'vitest';
import {
  blockMacCommand,
  normalizeMac,
  shellArg,
  uciBandFromBand,
  uciEncryptionFromSecurity,
  uciSet,
  unblockMacCommand,
} from '../../src/drivers/openwrt.commands.js';

describe('normalizeMac', () => {
  it('normaliza a minúsculas', () => {
    expect(normalizeMac('F0:18:98:AA:BB:CC')).toBe('f0:18:98:aa:bb:cc');
  });

  it('lanza para una MAC inválida', () => {
    expect(() => normalizeMac('no-es-mac')).toThrow(/MAC inválida/);
    expect(() => normalizeMac('f0:18:98:aa:bb')).toThrow(/MAC inválida/);
  });
});

describe('block/unblock MAC commands', () => {
  it('inserta una regla DROP idempotente (check antes de insertar)', () => {
    const cmd = blockMacCommand('F0:18:98:AA:BB:CC');
    expect(cmd).toContain('-C FORWARD -m mac --mac-source f0:18:98:aa:bb:cc -j DROP');
    expect(cmd).toContain('-I FORWARD -m mac --mac-source f0:18:98:aa:bb:cc -j DROP');
  });

  it('borra la regla de forma idempotente', () => {
    const cmd = unblockMacCommand('f0:18:98:aa:bb:cc');
    expect(cmd).toContain('-D FORWARD -m mac --mac-source f0:18:98:aa:bb:cc -j DROP');
    expect(cmd).toContain('|| true');
  });
});

describe('uciSet', () => {
  it('construye `uci set` con el valor entrecomillado', () => {
    expect(uciSet('default_radio0', 'ssid', 'Mi Red')).toBe(
      "uci set wireless.default_radio0.ssid='Mi Red'",
    );
  });
});

describe('mapeos UCI', () => {
  it('mapea seguridad a encryption', () => {
    expect(uciEncryptionFromSecurity('open')).toBe('none');
    expect(uciEncryptionFromSecurity('wpa2')).toBe('psk2');
    expect(uciEncryptionFromSecurity('wpa3')).toBe('sae');
    expect(uciEncryptionFromSecurity('wpa2/wpa3')).toBe('sae-mixed');
  });

  it('mapea banda a band', () => {
    expect(uciBandFromBand('2.4GHz')).toBe('2g');
    expect(uciBandFromBand('5GHz')).toBe('5g');
    expect(uciBandFromBand('6GHz')).toBe('6g');
  });
});

describe('shellArg', () => {
  it('escapa comillas simples', () => {
    expect(shellArg("a'b")).toBe("'a'\\''b'");
  });
});
