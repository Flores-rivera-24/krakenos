import { esCore } from './es-core';
import { esAjustes } from './fragments/ajustes';
import { esAuditoria } from './fragments/auditoria';
import { esCamaras } from './fragments/camaras';
import { esCobertura } from './fragments/cobertura';
import { esConectar } from './fragments/conectar';
import { esControlDeAcceso } from './fragments/controlDeAcceso';
import { esDns } from './fragments/dns';
import { esEnergia } from './fragments/energia';
import { esEntrada } from './fragments/entrada';
import { esEscenas } from './fragments/escenas';
import { esFirewall } from './fragments/firewall';
import { esGateway } from './fragments/gateway';
import { esHabitaciones } from './fragments/habitaciones';
import { esInventario } from './fragments/inventario';
import { esIot } from './fragments/iot';
import { esMatter } from './fragments/matter';
import { esPanel } from './fragments/panel';
import { esPersonas } from './fragments/personas';
import { esQos } from './fragments/qos';
import { esRutinas } from './fragments/rutinas';
import { esSondeo } from './fragments/sondeo';
import { esTrafico } from './fragments/trafico';
import { esUsuarios } from './fragments/usuarios';
import { esVlan } from './fragments/vlan';
import { esVpn } from './fragments/vpn';
import { esWifi } from './fragments/wifi';

/**
 * Catálogo de traducciones en español (US-177) — **fuente de la verdad**,
 * recompuesto desde el núcleo del arranque y los fragmentos por pantalla.
 *
 * Las claves de `TranslationKey` derivan de este objeto y el catálogo `en` está
 * tipado como `Record<TranslationKey, string>`: añadir una clave aquí obliga a
 * traducirla en `en.ts` (paridad garantizada en tiempo de compilación), también
 * las de los fragmentos.
 *
 * ⚠️ **El código de la app NO importa este módulo** (solo `import type`): importarlo
 * arrastra todos los fragmentos al chunk que lo haga, y si es el de entrada, al
 * arranque. Lo hace el núcleo (`./es-core`) por `lib/i18n/registro.ts`; los
 * fragmentos, cada pantalla. Los tests sí lo importan, para recorrer el catálogo
 * entero. Lo vigila `test/lib/catalogo-fragmentos.test.ts`.
 *
 * `es` es además el idioma por defecto: sus valores deben coincidir **carácter a
 * carácter** con el texto ya visible en la UI (los ~466 tests web los asertan).
 */
export const es = {
  ...esCore,
  ...esAjustes,
  ...esAuditoria,
  ...esCamaras,
  ...esCobertura,
  ...esConectar,
  ...esControlDeAcceso,
  ...esDns,
  ...esEnergia,
  ...esEntrada,
  ...esEscenas,
  ...esFirewall,
  ...esGateway,
  ...esHabitaciones,
  ...esInventario,
  ...esIot,
  ...esMatter,
  ...esPanel,
  ...esPersonas,
  ...esQos,
  ...esRutinas,
  ...esSondeo,
  ...esTrafico,
  ...esUsuarios,
  ...esVlan,
  ...esVpn,
  ...esWifi,
} as const;

/** Clave válida del catálogo (derivada de la fuente en español). */
export type TranslationKey = keyof typeof es;
