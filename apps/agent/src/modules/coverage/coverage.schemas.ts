// JSON Schemas de las rutas de cobertura WiFi (US-151). Validan body/params/
// querystring de entrada (`additionalProperties: false`) y serializan la
// respuesta. Mismo estilo que `wifi.schemas.ts`.

const bandEnum = ['2.4GHz', '5GHz', '6GHz'];
const wallMaterialEnum = ['drywall', 'wood', 'glass', 'brick', 'concrete', 'metal'];

// ---- Sub-esquemas reutilizables ----

const wallSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'x1', 'y1', 'x2', 'y2', 'material'],
  properties: {
    id: { type: 'string', minLength: 1, maxLength: 64 },
    x1: { type: 'number' },
    y1: { type: 'number' },
    x2: { type: 'number' },
    y2: { type: 'number' },
    material: { type: 'string', enum: wallMaterialEnum },
  },
} as const;

const apPlacementSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'apId', 'name', 'x', 'y', 'txPowerDbm', 'bands', 'enabled'],
  properties: {
    id: { type: 'string', minLength: 1, maxLength: 64 },
    apId: { type: ['string', 'null'] },
    name: { type: 'string', minLength: 1, maxLength: 120 },
    x: { type: 'number' },
    y: { type: 'number' },
    txPowerDbm: { type: 'number', minimum: -30, maximum: 40 },
    bands: { type: 'array', items: { type: 'string', enum: bandEnum } },
    enabled: { type: 'boolean' },
  },
} as const;

const floorPlanResponse = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    widthM: { type: 'number' },
    heightM: { type: 'number' },
    backgroundImage: { type: ['string', 'null'] },
    walls: { type: 'array', items: wallSchema, maxItems: 500 },
    accessPoints: { type: 'array', items: apPlacementSchema, maxItems: 64 },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
  required: [
    'id',
    'name',
    'widthM',
    'heightM',
    'backgroundImage',
    'walls',
    'accessPoints',
    'createdAt',
    'updatedAt',
  ],
} as const;

const heatmapResponse = {
  type: 'object',
  properties: {
    band: { type: 'string', enum: bandEnum },
    source: { type: 'string', enum: ['predicted', 'measured'] },
    widthM: { type: 'number' },
    heightM: { type: 'number' },
    cols: { type: 'integer' },
    rows: { type: 'integer' },
    cellSizeM: { type: 'number' },
    // Cada celda es el RSSI en dBm o `null` (sin dato).
    values: { type: 'array', items: { type: ['number', 'null'] } },
    minDbm: { type: 'number' },
    maxDbm: { type: 'number' },
  },
  required: [
    'band',
    'source',
    'widthM',
    'heightM',
    'cols',
    'rows',
    'cellSizeM',
    'values',
    'minDbm',
    'maxDbm',
  ],
} as const;

const placeableAccessPointResponse = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    model: { type: ['string', 'null'] },
    ip: { type: 'string' },
    online: { type: 'boolean' },
    bands: { type: 'array', items: { type: 'string', enum: bandEnum } },
  },
  required: ['id', 'name', 'model', 'ip', 'online', 'bands'],
} as const;

const surveyScanResponse = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    floorPlanId: { type: 'string' },
    name: { type: 'string' },
    band: { type: 'string', enum: bandEnum },
    deviceMac: { type: ['string', 'null'] },
    createdAt: { type: 'string', format: 'date-time' },
  },
  required: ['id', 'floorPlanId', 'name', 'band', 'deviceMac', 'createdAt'],
} as const;

const surveySampleResponse = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    scanId: { type: 'string' },
    x: { type: 'number' },
    y: { type: 'number' },
    rssiDbm: { type: 'integer' },
    createdAt: { type: 'string', format: 'date-time' },
  },
  required: ['id', 'scanId', 'x', 'y', 'rssiDbm', 'createdAt'],
} as const;

const surveyScanDetailResponse = {
  type: 'object',
  properties: {
    ...surveyScanResponse.properties,
    samples: { type: 'array', items: surveySampleResponse },
  },
  required: [...surveyScanResponse.required, 'samples'],
} as const;

const measureResultResponse = {
  type: 'object',
  properties: {
    found: { type: 'boolean' },
    rssiDbm: { type: ['number', 'null'] },
    sample: {
      type: ['object', 'null'],
      properties: surveySampleResponse.properties,
      required: [...surveySampleResponse.required],
    },
  },
  required: ['found', 'rssiDbm', 'sample'],
} as const;

// ---- Params / querystring ----

const idParams = {
  type: 'object',
  additionalProperties: false,
  required: ['id'],
  properties: { id: { type: 'string', minLength: 1 } },
} as const;

const scanIdParams = {
  type: 'object',
  additionalProperties: false,
  required: ['scanId'],
  properties: { scanId: { type: 'string', minLength: 1 } },
} as const;

const heatmapQuery = {
  type: 'object',
  additionalProperties: false,
  required: ['band'],
  properties: { band: { type: 'string', enum: bandEnum } },
} as const;

// ---- Cuerpos de escritura ----

const createFloorPlanBody = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'widthM', 'heightM'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 120 },
    widthM: { type: 'number', exclusiveMinimum: 0, maximum: 300 },
    heightM: { type: 'number', exclusiveMinimum: 0, maximum: 300 },
    backgroundImage: { type: ['string', 'null'] },
    walls: { type: 'array', items: wallSchema, maxItems: 500 },
    accessPoints: { type: 'array', items: apPlacementSchema, maxItems: 64 },
  },
} as const;

const updateFloorPlanBody = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 120 },
    widthM: { type: 'number', exclusiveMinimum: 0, maximum: 300 },
    heightM: { type: 'number', exclusiveMinimum: 0, maximum: 300 },
    backgroundImage: { type: ['string', 'null'] },
    walls: { type: 'array', items: wallSchema, maxItems: 500 },
    accessPoints: { type: 'array', items: apPlacementSchema, maxItems: 64 },
  },
} as const;

const createScanBody = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'band'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 120 },
    band: { type: 'string', enum: bandEnum },
    deviceMac: { type: ['string', 'null'], maxLength: 64 },
  },
} as const;

const recordSampleBody = {
  type: 'object',
  additionalProperties: false,
  required: ['x', 'y'],
  properties: {
    x: { type: 'number' },
    y: { type: 'number' },
    rssiDbm: { type: 'integer', minimum: -120, maximum: 0 },
  },
} as const;

// ---- Schemas por ruta ----

export const listFloorPlansSchema = {
  response: { 200: { type: 'array', items: floorPlanResponse } },
} as const;

export const createFloorPlanSchema = {
  body: createFloorPlanBody,
  response: { 201: floorPlanResponse },
} as const;

export const getFloorPlanSchema = {
  params: idParams,
  response: { 200: floorPlanResponse },
} as const;

export const updateFloorPlanSchema = {
  params: idParams,
  body: updateFloorPlanBody,
  response: { 200: floorPlanResponse },
} as const;

export const deleteFloorPlanSchema = {
  params: idParams,
} as const;

export const heatmapSchema = {
  params: idParams,
  querystring: heatmapQuery,
  response: { 200: heatmapResponse },
} as const;

export const accessPointsSchema = {
  response: { 200: { type: 'array', items: placeableAccessPointResponse } },
} as const;

export const listScansSchema = {
  params: idParams,
  response: { 200: { type: 'array', items: surveyScanResponse } },
} as const;

export const createScanSchema = {
  params: idParams,
  body: createScanBody,
  response: { 201: surveyScanResponse },
} as const;

export const getScanSchema = {
  params: scanIdParams,
  response: { 200: surveyScanDetailResponse },
} as const;

export const deleteScanSchema = {
  params: scanIdParams,
} as const;

export const recordSampleSchema = {
  params: scanIdParams,
  body: recordSampleBody,
  response: { 200: measureResultResponse },
} as const;

export const measuredHeatmapSchema = {
  params: scanIdParams,
  response: { 200: heatmapResponse },
} as const;
