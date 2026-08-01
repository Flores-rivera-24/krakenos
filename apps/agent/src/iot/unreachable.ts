import type { IotDevice, IotDeviceKind } from '@krakenos/types';

/**
 * Marcador de dispositivo **configurado pero sin respuesta** (US-242).
 *
 * Hasta ahora, un aparato que no contestaba **desaparecía de la lista**: el
 * `listDevices` de Shelly y Kasa/Tapo hacía `.catch(() => [])` por aparato. Para
 * el usuario, «apagado de la regleta» y «lo he desenchufado / se ha caído el WiFi»
 * se veían exactamente igual — el hueco donde antes había algo — y no hay forma de
 * distinguirlos mirando la pantalla.
 *
 * Ahora el aparato **sigue en la lista** con `reachable: false`, que es justo el
 * campo que el contrato ya tenía para esto. Los estados van a `null` a propósito:
 * no se sabe si está encendido, y **el último valor conocido sería una mentira con
 * pinta de dato fresco**.
 *
 * ⚠️ Solo para aparatos **configurados a mano** (el usuario declaró su IP, así que
 * existen aunque no respondan). Un aparato que solo aparece por descubrimiento y
 * hoy no contesta no se inventa: de ese no consta que exista.
 */
export function unreachableDevice(input: {
  id: string;
  name: string;
  kind: IotDeviceKind;
  room?: string | null;
}): IotDevice {
  return {
    id: input.id,
    name: input.name,
    kind: input.kind,
    room: input.room ?? null,
    reachable: false,
    on: null,
    brightness: null,
    color: null,
    readings: [],
    powerW: null,
    energyWh: null,
  };
}
