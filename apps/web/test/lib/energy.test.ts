import { describe, expect, it } from 'vitest';
import {
  energyIn,
  energyUnitFor,
  formatCost,
  formatEnergy,
  formatEnergyIn,
  formatEnergyTick,
  percentChange,
} from '@/lib/energy';

describe('lib/energy (US-182)', () => {
  describe('formatEnergy', () => {
    it('muestra Wh por debajo de 1 kWh', () => {
      expect(formatEnergy(0)).toBe('0 Wh');
      expect(formatEnergy(250)).toBe('250 Wh');
      expect(formatEnergy(999)).toBe('999 Wh');
    });

    it('muestra kWh a partir de 1000 Wh', () => {
      expect(formatEnergy(1000)).toBe('1,00 kWh');
      expect(formatEnergy(2500)).toBe('2,50 kWh');
    });
  });

  describe('escala común (tarjeta y eje del gráfico)', () => {
    it('elige la unidad por magnitud: kWh desde 1000 Wh', () => {
      expect(energyUnitFor(0)).toBe('Wh');
      expect(energyUnitFor(32)).toBe('Wh');
      expect(energyUnitFor(999.9)).toBe('Wh');
      expect(energyUnitFor(1000)).toBe('kWh');
      expect(energyUnitFor(2500)).toBe('kWh');
    });

    it('convierte sin redondear y escribe con la unidad', () => {
      expect(energyIn(32, 'Wh')).toBe(32);
      expect(energyIn(32, 'kWh')).toBe(0.032);
      expect(formatEnergyIn(32, 'Wh')).toBe('32 Wh');
      expect(formatEnergyIn(32, 'kWh')).toBe('0,03 kWh');
      expect(formatEnergy(32)).toBe(formatEnergyIn(32, energyUnitFor(32)));
    });

    it('las marcas del eje no llevan unidad (va en el título) y usan la coma', () => {
      expect(formatEnergyTick(0.016, 'kWh')).toBe('0,016');
      expect(formatEnergyTick(0.0005, 'kWh')).toBe('0,001'); // tope de 3 decimales
      expect(formatEnergyTick(32, 'Wh')).toBe('32');
      expect(formatEnergyTick(12.5, 'Wh')).toBe('12,5');
    });
  });

  describe('formatCost', () => {
    it('guion cuando no hay coste', () => {
      expect(formatCost(null, '€')).toBe('—');
    });

    it('formatea con la moneda', () => {
      expect(formatCost(1.5, '€')).toBe('1,50 €');
      expect(formatCost(0.2, '$')).toBe('0,20 $');
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
