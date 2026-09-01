import { BadRequestException, Inject, Injectable, Logger, Optional } from '@nestjs/common';

import {
  CustomerNotFoundError,
  DataSubjectRequestAlreadyDecidedError,
  DataSubjectRequestNotFoundError,
  DuplicateDataSubjectRequestError,
} from '../../domain/errors/auth.errors';
import { Role } from '../../domain/customer/role.enum';
import { HR_DIRECTORY_PORT, HrDirectoryPort } from '../ports/hr-directory.port';
import {
  DataSubjectRequestRecord,
  DataSubjectRequestStatus,
  DataSubjectRequestType,
  anonymisedIdentity,
  isDecidable,
} from '../../domain/data-subject/data-subject-request';
import {
  ERASURE_EXECUTORS,
  ERASURE_EXEMPTIONS,
  ErasureExecutor,
  ErasureExemption,
  ErasureOutcome,
  ErasureSubject,
} from '../ports/erasure-executor.port';
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
  /**
   * HQ deleting a staff account. Deliberately NOT `pdp.request.anonymised`: both run the
   * same machinery, but "the owner asked for it" and "an admin did it" answer different
   * questions, and an audit that mixes them cannot tell them apart afterwards.
   */
  STAFF_DELETED: 'staff.account.deleted',
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
    // Optional so existing construction sites (and the PDP specs) are untouched; the staff
    // deletion path logs and continues when it is absent rather than half-failing.
    @Optional() @Inject(HR_DIRECTORY_PORT) private readonly hr?: HrDirectoryPort,
    // Optional for the same reason as `hr`: every existing construction site (and the PDP
    // specs) keeps working, and an absent registry reports nothing rather than half-failing.
    @Optional() @Inject(ERASURE_EXECUTORS) private readonly erasers?: ErasureExecutor[],
    @Optional() @Inject(ERASURE_EXEMPTIONS) private readonly exemptions?: ErasureExemption[],
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

  /**
   * The staff queue, each row carrying the name of whoever raised it (§G-3). It used to
   * carry the customer id alone, so HQ decided a deletion request against eight hex
   * characters — the one queue where knowing who is asking is the whole job.
   *
   * The names come from this service's own accounts table, so there is nothing to fail
   * open on; an account that no longer exists (a completed DELETE) simply has none.
   */
  async listForStaff(
    status?: DataSubjectRequestStatus,
  ): Promise<(DataSubjectRequestRecord & { customerName: string | null })[]> {
    const rows = await this.requests.listForStaff(status);
    const accounts = await this.customers.findByIds([...new Set(rows.map((r) => r.customerId))]);
    const names = new Map(accounts.map((a) => [a.id, a.fullName ?? null]));
    return rows.map((r) => ({ ...r, customerName: names.get(r.customerId) ?? null }));
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
    // Read BEFORE `anonymiseCustomer` below: half the rows that survived erasure are keyed
    // on a phone with a null customerId, and once the account is scrubbed that key is gone.
    const account = await this.customers.findById(found.customerId);
    const coverage = await this.eraseEverywhere({
      customerId: found.customerId,
      phone: account?.phone ?? null,
    });
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
      // The coverage report rides on the audit row, so "what was actually erased" is a
      // question the trail can answer months later without re-running anything.
      metadata: { requestId: id, subject: found.customerId, coverage },
    });
    return { request };
  }

  /**
   * Fan the erasure out across every service the registry names, and REPORT the rest.
   *
   * The shape is `purge-executor.registry.ts`, and so is the rule it exists for: a dataset
   * with no executor is `UNENFORCED`, never skipped in silence. Before this, erasure was
   * one call to customer-service, and `docs/AUDIT_L3.md` §4.2 counted what that left
   * standing — 4.124 rows across eight tables, including 21 subscriptions still placing
   * orders to the phone number of somebody who had asked to be forgotten.
   *
   * Never throws. The account is already anonymised by the time this runs, and raising
   * here would report a failure for a deletion that has in fact largely happened. A
   * failed executor is recorded as `FAILED` with its message, which is a row a human can
   * act on — unlike an exception that rolls the whole request back to PENDING and loses
   * which halves succeeded.
   */
  private async eraseEverywhere(subject: ErasureSubject): Promise<ErasureOutcome[]> {
    const outcomes: ErasureOutcome[] = (this.exemptions ?? []).map((e) => ({
      dataset: e.dataset,
      coverage: 'EXEMPT' as const,
      rows: null,
      note: e.reason,
    }));

    for (const executor of this.erasers ?? []) {
      if (!executor.configured) {
        outcomes.push({
          dataset: executor.dataset,
          coverage: 'UNENFORCED',
          rows: null,
          note:
            executor.unenforcedReason ??
            'Owner service is not configured in this environment.',
        });
        this.logger.warn(`Erasure UNENFORCED for ${executor.dataset}: owner not configured`);
        continue;
      }
      try {
        const rows = await executor.erase(subject);
        outcomes.push({ dataset: executor.dataset, coverage: 'ERASED', rows, note: '' });
      } catch (error) {
        const note = (error as Error).message;
        outcomes.push({ dataset: executor.dataset, coverage: 'FAILED', rows: null, note });
        this.logger.error(`Erasure FAILED for ${executor.dataset}: ${note}`);
      }
    }
    return outcomes;
  }

  /**
   * HQ deleting a staff account (Fase 6). A new TRIGGER for the machinery above, not a
   * second implementation of it: the same cross-service anonymisation runs, so there is one
   * definition of what "deleted" means.
   *
   * Soft delete. A real row deletion is impossible here — orders, deliveries, payroll and
   * commissions across a dozen services hold this `customerId` with no foreign key, so
   * removing the row would leave references nobody can resolve. `DELETED` already refuses
   * login and is already filtered out of the staff directory.
   *
   * Money stays. Payroll, bonuses, deductions and loans keep their rows without an owner,
   * under the same FINANCIAL retention the departed-staff sweep uses; biometrics,
   * attendance and performance reviews go, exactly as in that sweep.
   *
   * Two guards, both because this cannot be undone: nobody deletes their own account (the
   * one account guaranteed to be signed in), and the last SUPER_ADMIN cannot be deleted —
   * that would leave a system nobody can administer, including to undo this.
   */
  async deleteStaffAccount(
    targetId: string,
    actorId: string,
  ): Promise<{ deleted: true; employeeAnonymised: boolean }> {
    if (targetId === actorId) {
      throw new BadRequestException('Akun sendiri tidak bisa dihapus.');
    }
    const target = await this.customers.findById(targetId);
    if (!target) {
      throw new CustomerNotFoundError();
    }
    // B-5: this route is the STAFF console's delete, and its siblings (`setStaffDepot`,
    // `setStaffActiveInternal`) both refuse a customer. Without the same refusal a
    // SUPER_ADMIN could erase an end customer through it — skipping the PDP request queue
    // that exists to record who asked and who decided, and filing it as `staff.account.deleted`.
    if (target.role === Role.CUSTOMER) {
      throw new BadRequestException(
        'Ini akun pelanggan, bukan staf. Penghapusan pelanggan lewat antrean permintaan PDP.',
      );
    }

    // B-4: the last-super-admin guard and the write are one transaction, in the repository.
    // Read-then-write raced, and the result — zero super admins — cannot be undone through
    // an API where every repair is SUPER_ADMIN-only.
    //
    // Closing the login FIRST, then scrubbing: the previous order carried a comment
    // promising the opposite invariant, and that promise was already untrue (B-6) because
    // `requests.anonymiseCustomer` writes `DELETED` in the same transaction as the scrub.
    // Of the two interrupted states, a login that is shut but still named is the safe one —
    // it is visibly unfinished and re-runnable, and nobody can sign in meanwhile.
    const outcome = await this.customers.markDeletedGuardingLastSuperAdmin(targetId);
    if (outcome === 'not-found') {
      throw new CustomerNotFoundError();
    }
    if (outcome === 'last-super-admin') {
      throw new BadRequestException(
        'Ini super admin terakhir. Angkat super admin lain dulu sebelum menghapus.',
      );
    }

    await this.customerData.anonymise(targetId);
    // Same fan-out as the customer path: a deleted staff account is a person too, and their
    // phone sits in the same crm/delivery/admin tables. One definition of "deleted".
    const coverage = await this.eraseEverywhere({ customerId: targetId, phone: target.phone ?? null });
    await this.requests.anonymiseCustomer(targetId, anonymisedIdentity(targetId));
    let employeeAnonymised = true;
    if (this.hr && target.role !== Role.FRANCHISE_OWNER) {
      // The employee half. Fail-soft: the login is already gone, and a raise here would
      // report failure for a deletion that has in fact happened. B-10: it is REPORTED
      // though — `{deleted: true}` with a silently orphaned employee record is how a
      // half-finished delete looks finished.
      try {
        await this.hr.anonymiseEmployee(targetId);
      } catch (err) {
        employeeAnonymised = false;
        this.logger.error(
          `Employee record for ${targetId} not anonymised: ${(err as Error).message}`,
        );
      }
    }

    await this.audit.record({
      customerId: actorId,
      action: PDP_AUDIT.STAFF_DELETED,
      success: true,
      ipAddress: null,
      userAgent: null,
      metadata: { subject: targetId, role: target.role, employeeAnonymised, coverage },
    });
    return { deleted: true, employeeAnonymised };
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
