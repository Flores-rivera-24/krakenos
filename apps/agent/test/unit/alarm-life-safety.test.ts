import type { HomeEvent, IotMetric } from '@krakenos/types';
import { IOT_METRICS, LIFE_SAFETY_METRICS, SECURITY_METRICS, isLifeSafetyMetric } from '@krakenos/types';
import { describe, expect, it } from 'vitest';
import {
  REARME_AVISO_VITAL_MS,
  claveDeAviso,
  decideAvisoVital,
  detalleDeAviso,
} from '../../src/alarm/life-safety.js';

const lectura = (metric: IotMetric, value: number, prevValue: number | null, deviceId = 'det-1'): HomeEvent => ({
  type: 'sensor-reading',
  deviceId,
  metric,
  value,
  prevValue,
});

describe('aviso de riesgo vital (US-245)', () => {
  const sinAvisos = new Map<string, number>();

  it('humo y CO son un subconjunto de las métricas de seguridad', () => {
    // Lo ata también el `satisfies` del tipo; aquí se comprueba en runtime para
    // que reordenar los arrays no despegue una cosa de la otra.
    for (const m of LIFE_SAFETY_METRICS) expect(SECURITY_METRICS).toContain(m);
    expect([...LIFE_SAFETY_METRICS]).toEqual(['smoke', 'co']);
  });

  it('ninguna otra métrica es de riesgo vital', () => {
    for (const metric of IOT_METRICS) {
      expect(isLifeSafetyMetric(metric), metric).toBe(
        (LIFE_SAFETY_METRICS as readonly string[]).includes(metric),
      );
    }
  });

  it('una activación de humo produce aviso', () => {
    const aviso = decideAvisoVital(lectura('smoke', 1, 0), sinAvisos, 1_000);
    expect(aviso).toMatchObject({ metric: 'smoke', deviceId: 'det-1', accion: 'alarm.smoke' });
  });

  it('una activación de CO produce su propio aviso', () => {
    const aviso = decideAvisoVital(lectura('co', 1, 0), sinAvisos, 1_000);
    expect(aviso?.accion).toBe('alarm.co');
  });

  it('⚠️ un detector combinado avisa de humo y de CO por separado', () => {
    // Misma máquina, dos riesgos: la clave de rearme lleva la métrica, así que
    // haber avisado de humo no puede silenciar el aviso de CO.
    const yaAvisoDeHumo = new Map([[claveDeAviso('det-1', 'smoke'), 0]]);
    expect(decideAvisoVital(lectura('smoke', 1, 0), yaAvisoDeHumo, 1_000)).toBeNull();
    expect(decideAvisoVital(lectura('co', 1, 0), yaAvisoDeHumo, 1_000)).not.toBeNull();
  });

  it('el valor que YA estaba alto no vuelve a avisar (solo el flanco de subida)', () => {
    expect(decideAvisoVital(lectura('smoke', 1, 1), sinAvisos, 1_000)).toBeNull();
  });

  it('volver a reposo no avisa', () => {
    expect(decideAvisoVital(lectura('smoke', 0, 1), sinAvisos, 1_000)).toBeNull();
  });

  it('sin valor previo SÍ avisa (un detector recién conectado que ya ve humo)', () => {
    // Ante la duda entre un aviso de más y un incendio en silencio, avisa.
    expect(decideAvisoVital(lectura('smoke', 1, null), sinAvisos, 1_000)).not.toBeNull();
  });

  it('ninguna otra métrica de seguridad entra por aquí', () => {
    // Una puerta que se abre es asunto de la alarma armada, no un riesgo vital.
    expect(decideAvisoVital(lectura('contact', 1, 0), sinAvisos, 1_000)).toBeNull();
    expect(decideAvisoVital(lectura('occupancy', 1, 0), sinAvisos, 1_000)).toBeNull();
  });

  it('una medida no es un suceso: potencia y temperatura no avisan', () => {
    for (const metric of ['power', 'temperature', 'humidity', 'battery'] as const) {
      expect(decideAvisoVital(lectura(metric, 99, 0), sinAvisos, 1_000), metric).toBeNull();
    }
  });

  it('otros eventos del bus no producen aviso', () => {
    expect(decideAvisoVital({ type: 'iot-on', deviceId: 'det-1' }, sinAvisos, 0)).toBeNull();
    expect(
      decideAvisoVital({ type: 'motion-detected', cameraId: 'c1', cameraName: 'Entrada' }, sinAvisos, 0),
    ).toBeNull();
  });

  describe('ventana de rearme', () => {
    const clave = claveDeAviso('det-1', 'smoke');

    it('un detector que oscila no genera cuarenta avisos', () => {
      const avisos = new Map([[clave, 1_000]]);
      // Mismo flanco 0→1 un minuto después: dentro de la ventana, se calla.
      expect(decideAvisoVital(lectura('smoke', 1, 0), avisos, 61_000)).toBeNull();
    });

    it('pasada la ventana vuelve a avisar (el riesgo sigue ahí)', () => {
      const avisos = new Map([[clave, 1_000]]);
      expect(decideAvisoVital(lectura('smoke', 1, 0), avisos, 1_000 + REARME_AVISO_VITAL_MS)).not.toBeNull();
    });

    it('la ventana es por aparato: el detector de al lado avisa igual', () => {
      const avisos = new Map([[clave, 1_000]]);
      expect(decideAvisoVital(lectura('smoke', 1, 0, 'det-2'), avisos, 2_000)).not.toBeNull();
    });
  });

  it('el detalle nombra el riesgo y el aparato', () => {
    expect(detalleDeAviso('smoke', 'Cocina')).toBe('Humo detectado en Cocina');
    expect(detalleDeAviso('co', 'Garaje')).toBe('Monóxido de carbono detectado en Garaje');
  });
});
