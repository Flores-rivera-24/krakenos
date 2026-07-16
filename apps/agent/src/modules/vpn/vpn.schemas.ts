import { TAILSCALE_STATES } from '@krakenos/types';

const peerResponse = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    publicKey: { type: 'string' },
    allowedIps: { type: 'string' },
    lastHandshake: { type: ['string', 'null'], format: 'date-time' },
    createdAt: { type: 'string', format: 'date-time' },
  },
  required: ['id', 'name', 'publicKey', 'allowedIps', 'lastHandshake', 'createdAt'],
} as const;

export const vpnStatusSchema = {
  response: {
    200: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean' },
        publicKey: { type: 'string' },
        endpoint: { type: ['string', 'null'] },
        listenPort: { type: 'integer' },
        peerCount: { type: 'integer' },
      },
      required: ['enabled', 'publicKey', 'endpoint', 'listenPort', 'peerCount'],
    },
  },
} as const;

export const listPeersSchema = {
  response: {
    200: { type: 'array', items: peerResponse },
  },
} as const;

export const createPeerSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['name'],
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 60 },
    },
  },
  response: {
    201: {
      type: 'object',
      properties: {
        peer: peerResponse,
        config: {
          type: 'object',
          properties: {
            config: { type: 'string' },
            qr: { type: 'string' },
          },
          required: ['config', 'qr'],
        },
      },
      required: ['peer', 'config'],
    },
  },
} as const;

export const tailscaleStatusSchema = {
  response: {
    200: {
      type: 'object',
      properties: {
        // Enum derivado de la fuente única en @krakenos/types (AUD-17).
        state: { type: 'string', enum: [...TAILSCALE_STATES] },
        tailscaleIp: { type: ['string', 'null'] },
        magicDnsName: { type: ['string', 'null'] },
        version: { type: ['string', 'null'] },
      },
      required: ['state', 'tailscaleIp', 'magicDnsName', 'version'],
    },
  },
} as const;

export const removePeerSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string', minLength: 1 } },
  },
  response: { 204: { type: 'null' } },
} as const;
