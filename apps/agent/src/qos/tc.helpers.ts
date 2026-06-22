import type { QosPriority } from '@krakenos/types';
import {
  assertInterfaceName,
  assertIpv4Cidr,
  assertNonNegativeInteger,
} from '../privileged/validators.js';

// Los constructores de argv validan interfaz, enteros (rate/classid/prio) y el
// objetivo IP antes de devolver el argv: ningún valor (env, store o regla) llega
// a `tc` con una bandera inyectada o un número/IP malformado.

/** `prio` de tc según la prioridad (menor = más prioritario). */
export function priorityToPrio(priority: QosPriority): number {
  return priority === 'high' ? 1 : priority === 'normal' ? 4 : 7;
}

/** ¿El objetivo es una IP/CIDR IPv4 (filtrable con u32)? */
export function isIpTarget(target: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}(\/\d{1,2})?$/.test(target);
}

export const tcQdiscDelRootArgs = (iface: string): string[] => [
  'tc', 'qdisc', 'del', 'dev', assertInterfaceName(iface), 'root',
];

export const tcQdiscAddRootArgs = (iface: string, defaultClassId: number): string[] => [
  'tc', 'qdisc', 'add', 'dev', assertInterfaceName(iface), 'root', 'handle', '1:',
  'htb', 'default', String(assertNonNegativeInteger(defaultClassId, 'classid por defecto')),
];

export const tcRootClassArgs = (iface: string, linkKbit: number): string[] => [
  'tc', 'class', 'add', 'dev', assertInterfaceName(iface), 'parent', '1:', 'classid', '1:1',
  'htb', 'rate', `${assertNonNegativeInteger(linkKbit, 'rate del enlace')}kbit`,
];

/** Clase hoja HTB con rate/ceil y prioridad. */
export function tcLeafClassArgs(
  iface: string,
  classId: number,
  rateKbit: number,
  prio: number,
): string[] {
  assertInterfaceName(iface);
  assertNonNegativeInteger(classId, 'classid');
  assertNonNegativeInteger(rateKbit, 'rate');
  assertNonNegativeInteger(prio, 'prio');
  return [
    'tc', 'class', 'add', 'dev', iface, 'parent', '1:1', 'classid', `1:${classId}`,
    'htb', 'rate', `${rateKbit}kbit`, 'ceil', `${rateKbit}kbit`, 'prio', String(prio),
  ];
}

/** Filtro u32 que dirige el tráfico hacia una IP destino a la clase. */
export function tcFilterIpArgs(iface: string, prio: number, ip: string, classId: number): string[] {
  assertInterfaceName(iface);
  assertNonNegativeInteger(prio, 'prio');
  assertIpv4Cidr(ip, 'objetivo QoS');
  assertNonNegativeInteger(classId, 'classid');
  return [
    'tc', 'filter', 'add', 'dev', iface, 'protocol', 'ip', 'parent', '1:', 'prio', String(prio),
    'u32', 'match', 'ip', 'dst', ip, 'flowid', `1:${classId}`,
  ];
}
