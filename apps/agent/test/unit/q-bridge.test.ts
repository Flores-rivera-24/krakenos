import { describe, expect, it } from 'vitest';
import {
  RowStatus,
  createVlanVarbinds,
  destroyVlanVarbinds,
  renameVlanVarbinds,
  vlanNameOid,
  vlanRowStatusOid,
} from '../../src/vlan/q-bridge.js';

describe('OIDs Q-BRIDGE', () => {
  it('indexan la tabla estática por el tag de VLAN', () => {
    expect(vlanNameOid(30)).toBe('1.3.6.1.2.1.17.7.1.4.3.1.1.30');
    expect(vlanRowStatusOid(30)).toBe('1.3.6.1.2.1.17.7.1.4.3.1.5.30');
  });
});

describe('builders de varbinds', () => {
  it('crear: RowStatus createAndGo + nombre', () => {
    expect(createVlanVarbinds(30, 'IoT')).toEqual([
      { oid: '1.3.6.1.2.1.17.7.1.4.3.1.5.30', type: 'Integer', value: RowStatus.createAndGo },
      { oid: '1.3.6.1.2.1.17.7.1.4.3.1.1.30', type: 'OctetString', value: 'IoT' },
    ]);
  });

  it('renombrar: solo el nombre', () => {
    expect(renameVlanVarbinds(30, 'IoT-2')).toEqual([
      { oid: '1.3.6.1.2.1.17.7.1.4.3.1.1.30', type: 'OctetString', value: 'IoT-2' },
    ]);
  });

  it('destruir: RowStatus destroy', () => {
    expect(destroyVlanVarbinds(30)).toEqual([
      { oid: '1.3.6.1.2.1.17.7.1.4.3.1.5.30', type: 'Integer', value: RowStatus.destroy },
    ]);
  });
});
