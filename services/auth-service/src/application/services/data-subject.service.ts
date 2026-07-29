import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  DataSubjectRequestAlreadyDecidedError,
  DataSubjectRequestNotFoundError,
  DuplicateDataSubjectRequestError,
} from '../../domain/errors/auth.errors';
import {
  DataSubjectRequestRecord,
  DataSubjectRequestStatus,
  DataSubjectRequestType,
  anonymisedIdentity,
  isDecidable,
} from '../../domain/data-subject/data-subject-request';
import { ConsentService } from './consent.service';
import { CustomerDataPort } from '../ports/customer-data.port';
import { CustomerRepository } from '../ports/customer.repository';
import { DataSubjectRequestRepository } from '../ports/data-subject-request.repository';
import { AUTH_TOKENS } from '../tokens';
import { AuditService } from './audit.service';

/** Audit actions for the PDP queue — greppable and stable. */
export const PDP_AUDIT = {
  REQUESTED: 'pdp.request.created',
  EXPORTED: 'pdp.request.exported',
  DELETED: 'pdp.request.anonymised',
  REJECTED: 'pdp.request.rejected',
} as const;

export interface DataExport {
  exportedAt: string;
  account: Record<string, unknown>;
  /** Every consent decision, so the export proves what was agreed and when. */
  consents: unknown[];
  /** What customer-service holds: profile, addresses, payment-method labels. */
  customer: Record<string, unknown>;
  /**
   * Stated in the payload itself so the recipient is not left guessing: order and
   * payment history is retained under the FINANCIAL class and is not part of tahap 1.
   */
  notIncluded: string[];
}

/**
 * UU PDP tahap 1 (item 13): the customer asks, HEAD OFFICE decides, the system executes.
 *
 * Approving an EXPORT builds the payload on the spot rather than storing it — a stored
 * copy of everything we hold about a person is a second copy to leak, and the request
 * row is the audit trail either way.
 */
@Injectable()
export class DataSubjectService {
  private readonly logger = new Logger(DataSubjectService.name);

  constructor(
    @Inject(AUTH_TOKENS.DataSubjectRequestRepository)
    private readonly requests: DataSubjectRequestRepository,
    @Inject(AUTH_TOKENS.CustomerRepository) private readonly customers: CustomerRepository,
    @Inject(AUTH_TOKENS.CustomerDataPort) private readonly customerData: CustomerDataPort,
    private readonly audit: AuditService,
    private readonly consents: ConsentService,
  ) {}

  /** Raise a request. A second one of the same type while the first is open is refused. */
  async request(
    customerId: string,
    type: DataSubjectRequestType,
    reason: string | null,
  ): Promise<DataSubjectRequestRecord> {
    const open = await this.requests.findOpen(customerId, type);
    if (open) throw new DuplicateDataSubjectRequestError();

    const created = await this.requests.create({ customerId, type, reason });
    await this.audit.record({
      customerId,
      action: PDP_AUDIT.REQUESTED,
      success: true,
      ipAddress: null,
      userAgent: null,
      metadata: { requestId: created.id, type },
    });
    return created;
  }

  listMine(customerId: string): Promise<DataSubjectRequestRecord[]> {
    return this.requests.listByCustomer(customerId);
  }

  listForStaff(status?: DataSubjectRequestStatus): Promise<DataSubjectRequestRecord[]> {
    return this.requests.listForStaff(status);
  }

  /**
   * Approve: run the right, then close the request. The side effect happens FIRST — if
   * the anonymisation fails, the request stays PENDING and can be retried, rather than
   * being marked done over data that was never touched.
   */
  async approve(
    id: string,
    staffId: string,
  ): Promise<{ request: DataSubjectRequestRecord; export?: DataExport }> {
    const found = await this.pendingOrThrow(id);

    if (found.type === 'EXPORT') {
      const payload = await this.buildExport(found.customerId);
      const request = await this.requests.decide({
        id,
        status: 'COMPLETED',
        processedBy: staffId,
        reason: null,
      });
      await this.audit.record({
        customerId: staffId,
        action: PDP_AUDIT.EXPORTED,
        success: true,
        ipAddress: null,
        userAgent: null,
        metadata: { requestId: id, subject: found.customerId },
      });
      return { request, export: payload };
    }

    await this.customerData.anonymise(found.customerId);
    await this.requests.anonymiseCustomer(found.customerId, anonymisedIdentity(found.customerId));
    const request = await this.requests.decide({
      id,
      status: 'COMPLETED',
      processedBy: staffId,
      reason: null,
    });
    await this.audit.record({
      customerId: staffId,
      action: PDP_AUDIT.DELETED,
      success: true,
      ipAddress: null,
      userAgent: null,
      metadata: { requestId: id, subject: found.customerId },
    });
    return { request };
  }

  /** Refuse with a reason. A refusal without one tells the customer nothing. */
  async reject(id: string, staffId: string, reason: string): Promise<DataSubjectRequestRecord> {
    await this.pendingOrThrow(id);
    const request = await this.requests.decide({
      id,
      status: 'REJECTED',
      processedBy: staffId,
      reason,
    });
    await this.audit.record({
      customerId: staffId,
      action: PDP_AUDIT.REJECTED,
      success: true,
      ipAddress: null,
      userAgent: null,
      metadata: { requestId: id, subject: request.customerId, reason },
    });
    return request;
  }

  /** The customer downloads their own completed export; staff never hold a stored copy. */
  async exportFor(customerId: string): Promise<DataExport> {
    return this.buildExport(customerId);
  }

  private async buildExport(customerId: string): Promise<DataExport> {
    const account = await this.customers.findById(customerId);
    const consents = await this.consents.history(customerId);
    let customer: Record<string, unknown> = {};
    try {
      customer = await this.customerData.export(customerId);
    } catch (error) {
      // A downstream outage must not silently produce a half-empty export that looks
      // complete. Say so in the payload instead.
      this.logger.error(`customer-service export failed for ${customerId}: ${(error as Error).message}`);
      customer = { error: 'customer-service unreachable; profile and addresses missing' };
    }
    return {
      exportedAt: new Date().toISOString(),
      account: account
        ? {
            id: account.id,
            phone: account.phone,
            email: account.email,
            fullName: account.fullName,
            role: account.role,
            status: account.status,
            createdAt: account.createdAt,
          }
        : {},
      customer,
      consents,
      notIncluded: [
        'Riwayat pesanan dan pembayaran (kelas retensi FINANCIAL, disimpan 10 tahun)',
        'Catatan poin loyalty',
      ],
    };
  }

  private async pendingOrThrow(id: string): Promise<DataSubjectRequestRecord> {
    const found = await this.requests.findById(id);
    if (!found) throw new DataSubjectRequestNotFoundError();
    if (!isDecidable(found)) throw new DataSubjectRequestAlreadyDecidedError();
    return found;
  }
}
