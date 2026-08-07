import { describe, expect, it } from 'vitest';
import {
  blockMacCommand,
  parseFirewallStack,
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

  // --- Camino nftables (US-255) ---
  //
  // OpenWrt 22.03+ trae fw4/nftables y ya no instala `iptables` de serie. El
  // proyecto lo daba por resuelto en un COMENTARIO («compat iptables-nft») que
  // nada instalaba ni comprobaba: en un router moderno el bloqueo fallaba.

  it('el bloqueo cae a nft cuando no hay iptables', () => {
    const cmd = blockMacCommand('f0:18:98:aa:bb:cc');
    expect(cmd).toContain('command -v iptables');
    expect(cmd).toContain('nft insert rule inet fw4 forward ether saddr f0:18:98:aa:bb:cc drop');
  });

  it('nft INSERTA, no añade: al final de la cadena fw4 ya ha aceptado el paquete', () => {
    // `add` pondría la regla detrás de las de aceptación de fw4, así que el
    // bloqueo «se aplicaría» sin cortar nada — un fallo mudo, que es el peor.
    const cmd = blockMacCommand('f0:18:98:aa:bb:cc');
    expect(cmd).toContain('nft insert rule');
    expect(cmd).not.toContain('nft add rule');
  });

  it('el desbloqueo por nft resuelve el handle: no hay borrado por contenido', () => {
    const cmd = unblockMacCommand('f0:18:98:aa:bb:cc');
    expect(cmd).toContain('nft -a list chain inet fw4 forward');
    expect(cmd).toContain('nft delete rule inet fw4 forward handle');
    // Sin regla no hay handle, y eso no es un error.
    expect(cmd).toContain('|| true');
  });

  it('la pila desconocida se lee como `none`: falla cerrado', () => {
    expect(parseFirewallStack('iptables\n')).toBe('iptables');
    expect(parseFirewallStack('nft')).toBe('nft');
    expect(parseFirewallStack('none')).toBe('none');
    // Salida rara o transporte caído → `none`. Suponer que hay cortafuegos es lo
    // que deja el panel diciendo «Bloqueado» sin nada que corte.
    expect(parseFirewallStack('')).toBe('none');
    expect(parseFirewallStack(null)).toBe('none');
    expect(parseFirewallStack('ash: nft: not found')).toBe('none');
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
