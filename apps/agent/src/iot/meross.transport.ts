import { type MqttTransport, MqttClientTransport } from './mqtt.transport.js';

/**
 * Transporte de Meross. Meross habla **MQTT local**, así que reutiliza el mismo
 * `MqttTransport` (e import perezoso de `mqtt`) que la integración Zigbee — aquí
 * solo se construye a partir del host/puerto del broker. El manager no conoce
 * `mqtt`: opera contra la interfaz `MqttTransport`, testeable con un transporte
 * falso.
 */

export interface MerossBrokerOptions {
  /** Host del broker MQTT local (Mosquitto), p. ej. `192.168.1.5`. */
  host: string;
  /** Puerto del broker (por defecto 1883). */
  port?: number;
  username?: string;
  password?: string;
}

/** Construye el transporte MQTT para Meross a partir del broker local. */
export function createMerossTransport(opts: MerossBrokerOptions): MqttTransport {
  return new MqttClientTransport({
    url: `mqtt://${opts.host}:${opts.port ?? 1883}`,
    username: opts.username,
    password: opts.password,
  });
}
