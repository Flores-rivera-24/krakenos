import { describe, expect, it } from 'vitest';
import { formatCost, formatEnergy, percentChange } from '@/lib/energy';

describe('lib/energy (US-182)', () => {
  describe('formatEnergy', () => {
    it('muestra Wh por debajo de 1 kWh', () => {
      expect(formatEnergy(0)).toBe('0 Wh');
      expect(formatEnergy(250)).toBe('250 Wh');
      expect(formatEnergy(999)).toBe('999 Wh');
    });

    it('muestra kWh a partir de 1000 Wh', () => {
      expect(formatEnergy(1000)).toBe('1.00 kWh');
      expect(formatEnergy(2500)).toBe('2.50 kWh');
    });
  });

  describe('formatCost', () => {
    it('guion cuando no hay coste', () => {
      expect(formatCost(null, '€')).toBe('—');
    });

    it('formatea con la moneda', () => {
      expect(formatCost(1.5, '€')).toBe('1.50 €');
      expect(formatCost(0.2, '$')).toBe('0.20 $');
    });
  });

  describe('percentChange', () => {
    it('null si el periodo anterior es 0 (no divide por cero)', () => {
      expect(percentChange(100, 0)).toBeNull();
    });

    it('calcula la variación redondeada', () => {
      expect(percentChange(150, 100)).toBe(50);
      expect(percentChange(80, 100)).toBe(-20);
    });
  });
});
