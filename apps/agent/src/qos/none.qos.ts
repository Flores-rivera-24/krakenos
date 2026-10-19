import type {
  CreateQosRuleRequest,
  QosManager,
  QosRule,
  UpdateQosRuleRequest,
} from '@krakenos/types';
import { DomainNotConfiguredError } from '../integrations/not-configured.js';

/** QoS «sin configurar» (`QOS_KIND=none`): sin reglas; escribir es un 409. */
export class NoneQosManager implements QosManager {
  readonly kind = 'none' as const;
  readonly notConfigured = true as const;

  async listRules(): Promise<QosRule[]> {
    return [];
  }

  async getRule(_id: string): Promise<QosRule | null> {
    return null;
  }

  async createRule(_input: CreateQosRuleRequest): Promise<QosRule> {
    throw new DomainNotConfiguredError('qos');
  }

  async updateRule(_id: string, _patch: UpdateQosRuleRequest): Promise<QosRule | null> {
    throw new DomainNotConfiguredError('qos');
  }

  async removeRule(_id: string): Promise<boolean> {
    throw new DomainNotConfiguredError('qos');
  }
}
