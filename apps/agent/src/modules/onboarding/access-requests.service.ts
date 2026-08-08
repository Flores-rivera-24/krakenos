import type {
  AccessRequest,
  AccessRequestStatus,
  CreateAccessRequestRequest,
} from '@krakenos/types';
import type { PrismaClient } from '@prisma/client';

export class AccessRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AccessRequestError';
  }
}

interface AccessRequestRow {
  id: string;
  email: string;
  displayName: string;
  status: string;
  note: string | null;
  decidedAt: Date | null;
  createdAt: Date;
}

function toAccessRequest(row: AccessRequestRow): AccessRequest {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    status: row.status as AccessRequestStatus,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
  };
}

/**
 * Solicitudes de acceso al hogar (US-273).
 *
 * Quien vive en la casa pide entrada desde la propia pantalla de acceso; el admin
 * decide, y decide también el rol. No es autorregistro: sin la aprobación no existe
 * ninguna cuenta ni ninguna credencial.
 */
export class AccessRequestsService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Registra la solicitud. **Idempotente por correo**: volver a pedirlo actualiza la
   * que ya había en vez de llenar la bandeja del admin con la misma persona repetida
   * (que es exactamente lo que haría alguien impaciente, o un script).
   *
   * Devuelve `void` a propósito. La ruta responde siempre lo mismo, exista ya el
   * correo o no: si respondiera distinto, un extraño podría averiguar desde fuera
   * quién tiene cuenta en la casa.
   */
  async request(body: CreateAccessRequestRequest): Promise<void> {
    // Con cuenta ya creada no se registra nada: no hay nada que aprobar. La ruta
    // responde igual, así que desde fuera es indistinguible.
    const existingUser = await this.prisma.user.findUnique({ where: { email: body.email } });
    if (existingUser) return;

    const previa = await this.prisma.accessRequest.findUnique({ where: { email: body.email } });
    // Una solicitud ya rechazada no se reabre sola: si se pudiera, el «no» del admin
    // duraría lo que tarde el interesado en volver a pulsar el botón.
    if (previa?.status === 'rejected') return;

    await this.prisma.accessRequest.upsert({
      where: { email: body.email },
      create: {
        email: body.email,
        displayName: body.displayName,
        ...(body.note !== undefined ? { note: body.note } : {}),
      },
      update: {
        displayName: body.displayName,
        ...(body.note !== undefined ? { note: body.note } : {}),
      },
    });
  }

  async list(status?: AccessRequestStatus): Promise<AccessRequest[]> {
    const rows = await this.prisma.accessRequest.findMany({
      ...(status !== undefined ? { where: { status } } : {}),
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toAccessRequest);
  }

  /** Marca la decisión. La creación de la cuenta NO ocurre aquí: ver `DecideAccessRequestRequest`. */
  async decide(
    id: string,
    decision: 'approve' | 'reject',
    decidedById: string,
  ): Promise<AccessRequest> {
    const row = await this.prisma.accessRequest.findUnique({ where: { id } });
    if (!row) throw new AccessRequestError('NOT_FOUND', 'Solicitud no encontrada');
    if (row.status !== 'pending') {
      throw new AccessRequestError('ALREADY_DECIDED', 'La solicitud ya estaba decidida');
    }
    const updated = await this.prisma.accessRequest.update({
      where: { id },
      data: {
        status: decision === 'approve' ? 'approved' : 'rejected',
        decidedAt: new Date(),
        decidedById,
      },
    });
    return toAccessRequest(updated);
  }
}
