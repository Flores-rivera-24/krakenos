import type { IsoDateTime } from './common.js';

/**
 * Ventana temporal para las estadísticas de consumo eléctrico (US-181/182).
 * Reusa el mismo vocabulario que el tráfico para no divergir en la UI.
 */
export type EnergyRange = 'day' | 'week' | 'month';

/** Punto agregado del histórico de energía: media de potencia en el bucket. */
export interface EnergyBucket {
  /** Inicio del bucket. */
  timestamp: IsoDateTime;
  /** Media de potencia (W) en el intervalo del bucket. */
  powerW: number;
  /** Energía estimada en el bucket (Wh), integrando la potencia en el tiempo. */
  energyWh: number;
}

/** Consumo histórico agregado de un dispositivo IoT concreto en una ventana. */
export interface DeviceEnergyStats {
  /** Id del dispositivo en el `IotManager` (namespaced en composite: `hue:x`). */
  deviceId: string;
  /** Nombre amigable actual del dispositivo; `null` si ya no está en el manager. */
  name: string | null;
  /** Estancia del dispositivo, si se conoce. */
  room: string | null;
  /** Energía total estimada consumida en la ventana (Wh). */
  energyWh: number;
  /** Coste estimado en la moneda del hogar (kWh × precio); `null` sin precio. */
  cost: number | null;
  /** Serie agregada en buckets (orden cronológico) para la mini-gráfica. */
  buckets: EnergyBucket[];
}

/**
 * Configuración de energía del hogar (US-182): precio del kWh y símbolo de moneda,
 * usados para estimar el coste. El precio es `null` mientras no se configure.
 */
export interface EnergyConfig {
  /** Precio por kWh en la moneda del hogar; `null` si no está configurado. */
  pricePerKwh: number | null;
  /** Símbolo de la moneda para mostrar el coste (por defecto `€`). */
  currency: string;
}

/**
 * Estadísticas de consumo eléctrico para una ventana temporal (US-182). El total
 * y el coste agregan todos los dispositivos con medición; el desglose va en
 * `devices` (orden descendente por energía).
 */
export interface EnergyStats {
  range: EnergyRange;
  /** Serie agregada del hogar (suma de todos los dispositivos, cronológica). */
  buckets: EnergyBucket[];
  /** Energía total estimada del hogar en la ventana (Wh). */
  totalEnergyWh: number;
  /** Energía total del periodo inmediatamente anterior (misma duración), para comparar. */
  previousTotalEnergyWh: number;
  /** Precio del kWh usado para el coste (moneda del hogar); `null` si no configurado. */
  pricePerKwh: number | null;
  /** Símbolo de la moneda para mostrar el coste. */
  currency: string;
  /** Coste total estimado (`totalEnergyWh/1000 × pricePerKwh`); `null` sin precio. */
  totalCost: number | null;
  /** Coste del periodo anterior (misma duración); `null` sin precio. */
  previousTotalCost: number | null;
  /** Desglose por dispositivo, orden descendente por energía. */
  devices: DeviceEnergyStats[];
}
