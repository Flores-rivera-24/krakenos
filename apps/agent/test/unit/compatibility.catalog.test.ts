import { describe, expect, it } from 'vitest';
import { buildCompatibilityCatalog } from '../../src/modules/compatibility/compatibility.catalog.js';
import { INTEGRATION_SCHEMA } from '../../src/integrations/schema.js';

describe('buildCompatibilityCatalog (US-208)', () => {
  const catalog = buildCompatibilityCatalog();
  const byId = (id: string) => catalog.find((e) => e.id === id);

  it('deriva del catálogo de integraciones (no es una lista a mano)', () => {
    // OpenWrt y Pi-hole están en el schema → aparecen.
    expect(byId('driver:openwrt')?.label).toBe(INTEGRATION_SCHEMA.driver.openwrt!.label);
    expect(byId('dns:pihole')).toBeTruthy();
    expect(byId('iot:hue')).toBeTruthy();
  });

  it('excluye el modo demostración (mock/zeroConfig)', () => {
    expect(catalog.some((e) => e.id.endsWith(':mock'))).toBe(false);
    expect(byId('iot:tuya')).toBeTruthy(); // tuya no es zeroConfig aunque no tenga campos
  });

  it('asigna capacidades por categoría; el driver suma WiFi si lo soporta', () => {
    const openwrt = byId('driver:openwrt');
    expect(openwrt?.capabilities).toEqual(expect.arrayContaining(['inventory', 'block', 'traffic', 'wifi']));
    // pfSense no gestiona WiFi (wifiSupported ausente).
    const pfsense = byId('driver:pfsense');
    expect(pfsense?.capabilities).not.toContain('wifi');

    expect(byId('dns:pihole')?.capabilities).toEqual(['dns-block']);
    expect(byId('iot:hue')?.capabilities).toEqual(['control']);
  });

  it('deriva requisitos de los campos + deps opcionales', () => {
    // Hue: URL del bridge (address) + appKey secreto (credentials).
    expect(byId('iot:hue')?.requirements).toEqual(expect.arrayContaining(['address', 'credentials']));
    // OpenWrt: host + contraseña + dep node-ssh.
    expect(byId('driver:openwrt')?.requirements).toEqual(
      expect.arrayContaining(['address', 'credentials', 'extra-dependency']),
    );
  });

  it('nada está verificado con hardware real todavía (US-86): la fecha es null', () => {
    // US-258: `verifiedAt` en vez de un booleano. Hoy son cero verificaciones y el
    // mapa `HARDWARE_VERIFIED_AT` está vacío a propósito, así que esto vale para
    // todo el catálogo — y el día que deje de valer será porque alguien enchufó un
    // aparato, no porque se haya tocado la tabla para que se vea mejor.
    expect(catalog.every((e) => e.verifiedAt === null)).toBe(true);
  });

  // --- Nivel de soporte (US-238) ---

  it('marca community lo que necesita la app del fabricante, y core lo demás', () => {
    // El criterio es el de `docs/adr-control-total.md`: protocolo abierto o
    // emparejamiento local = core; app/nube del fabricante = community.
    const nivel = (id: string) => byId(id)?.support;
    expect(nivel('iot:tuya')).toBe('community');
    expect(nivel('iot:govee')).toBe('community');
    expect(nivel('iot:meross')).toBe('community');
    expect(nivel('iot:zigbee')).toBe('core');
    expect(nivel('iot:matter')).toBe('core');
    expect(nivel('iot:hue')).toBe('core');
    expect(nivel('iot:shelly')).toBe('core');
    expect(nivel('iot:kasa')).toBe('core');
  });

  // --- Dependencia de la app del fabricante (US-258) ---

  it('todo lo `community` declara qué necesita de la app: es su definición', () => {
    // El ADR define `community` como «necesita la app o la nube del fabricante al
    // menos una vez». Si una entrada es community y no dice para qué, el aviso de la
    // UI se queda en un sello genérico y el usuario no sabe qué le van a pedir.
    // Al revés NO se exige: `core` puede tener dependencia (Kasa/Tapo).
    const community = catalog.filter((e) => e.support === 'community');
    expect(community.length).toBeGreaterThan(0); // guard: si el filtro se rompe, no pasa en vacío
    for (const e of community) {
      expect(e.appDependency, `${e.id} es community y no declara la dependencia`).not.toBeNull();
    }
  });

  it('Kasa/Tapo: `core` con dependencia acotada a parte del parque', () => {
    // El caso que no tenía marca posible antes de US-258. Marcar todo el backend
    // sería falso para un enchufe Kasa; no marcarlo, falso para un Tapo.
    expect(byId('iot:kasa')?.appDependency).toEqual({
      reason: 'account',
      scope: 'some',
      devices: 'Tapo',
    });
  });

  it('lo que habla protocolo abierto no declara dependencia, y fuera de IoT tampoco', () => {
    for (const id of ['iot:zigbee', 'iot:matter', 'iot:hue', 'iot:shelly', 'iot:mqtt']) {
      expect(byId(id)?.appDependency, `${id} no debería depender de ninguna app`).toBeNull();
    }
    // Los demás dominios (SSH, REST local, SNMP, RTSP…) no tienen app de por medio.
    for (const e of catalog.filter((x) => x.category !== 'iot')) {
      expect(e.appDependency, `${e.id} no es IoT: no debería declarar app`).toBeNull();
    }
  });

  it('los dominios que no son IoT son core: hablan protocolos abiertos', () => {
    const noIot = catalog.filter((e) => e.category !== 'iot');
    // Guard de recolección: si el filtro dejara de recoger, la aserción de abajo
    // pasaría sobre una lista vacía sin comprobar nada.
    expect(noIot.length).toBeGreaterThan(5);
    expect(noIot.every((e) => e.support === 'core')).toBe(true);
  });

  it('TODA entrada declara su nivel: ninguna se queda sin clasificar', () => {
    // Es el fallo que el mapa exhaustivo evita en compilación; aquí se comprueba
    // también en ejecución, porque un `as` mal puesto lo dejaría en `undefined`
    // y la UI simplemente no pintaría el aviso — un fallo silencioso.
    const sinNivel = catalog.filter((e) => e.support !== 'core' && e.support !== 'community');
    expect(sinNivel.map((e) => e.id)).toEqual([]);
  });

  it('community NO es un cajón de sastre: la mayoría del catálogo sigue siendo core', () => {
    // Si algún día casi todo acabara en community, el catálogo dejaría de
    // informar. Que salte el test es la señal para replantear el producto.
    const community = catalog.filter((e) => e.support === 'community');
    expect(community.length).toBeGreaterThan(0);
    expect(community.length).toBeLessThan(catalog.length / 2);
  });

  it('ordena por nombre y no está vacío', () => {
    expect(catalog.length).toBeGreaterThan(5);
    const labels = catalog.map((e) => e.label);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b)));
  });
});
