/**
 * Lookup de fabricante por OUI (los 3 primeros octetos de la MAC).
 *
 * Conjunto curado de prefijos comunes. Para cobertura total se puede
 * reemplazar por el dataset oficial de la IEEE, manteniendo esta interfaz.
 */
const OUI: Record<string, string> = {
  '245A4C': 'Ubiquiti',
  '00156D': 'Ubiquiti',
  F01898: 'Apple',
  A4B197: 'Apple',
  '3C0754': 'Apple',
  '240AC4': 'Espressif',
  '7C9EBD': 'Espressif',
  '8C4B14': 'Espressif',
  B827EB: 'Raspberry Pi',
  DCA632: 'Raspberry Pi',
  E45F01: 'Raspberry Pi',
  '001B21': 'Intel',
  '3C970E': 'Intel',
  AC233F: 'Samsung',
  '402178': 'Samsung',
  '500291': 'TP-Link',
  '1027F5': 'TP-Link',
  D83ADD: 'Google',
  F4F5D8: 'Google',
  FC65DE: 'Amazon',
  '44650D': 'Amazon',
  '6CAB31': 'Roku',
};

/** Normaliza una MAC a sus 6 primeros dígitos hex en mayúscula. */
function ouiKey(mac: string): string {
  return mac.replace(/[^0-9a-fA-F]/g, '').slice(0, 6).toUpperCase();
}

/** Devuelve el fabricante por OUI, o `null` si no se reconoce. */
export function lookupVendor(mac: string): string | null {
  return OUI[ouiKey(mac)] ?? null;
}
