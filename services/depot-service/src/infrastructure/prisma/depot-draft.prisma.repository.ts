import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { DepotChecklist, depotOnboarded, DepotDraftRecord } from '../../domain/depot-draft';
import { DepotDraftConflictError, DuplicateDepotCodeError } from '../../domain/errors';
import { CreateDepotData } from '../../application/ports/depot.repository';
import {
  DepotDraftRepository,
  ListDepotDraftsFilter,
  NewDepotDraft,
} from '../../application/ports/depot-draft.repository';
import { PrismaService } from './prisma.service';

type Row = Awaited<ReturnType<PrismaService['depotDraft']['findUniqueOrThrow']>>;

const toRecord = (r: Row): DepotDraftRecord => ({ ...r, checklist: r.checklist as unknown as DepotChecklist });

/** UU PDP: the owner's name and phone are not kept past the decision, nor the replay hash that covered them. */
const CLEARED = { ownerFullName: null, ownerPhoneE164: null, requestHash: null } as const;

const columns = ({ checklist, ...rest }: NewDepotDraft) => ({
  ...rest,
  checklist: checklist as unknown as Prisma.InputJsonValue,
});

@Injectable()
export class DepotDraftPrismaRepository implements DepotDraftRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByProspectId(prospectId: string): Promise<DepotDraftRecord | null> {
    const row = await this.prisma.depotDraft.findUnique({ where: { prospectId } });
    return row ? toRecord(row) : null;
  }

  async create(data: NewDepotDraft): Promise<DepotDraftRecord> {
    return toRecord(await this.prisma.depotDraft.create({ data: columns(data) }));
  }

  async reopen(id: string, data: NewDepotDraft): Promise<DepotDraftRecord | null> {
    // The prospect stays and createdAt stays the FIRST creation; the new content, the new
    // suggestion id and the new author replace the old (the audit trail keeps every suggestion id).
    const content: Partial<ReturnType<typeof columns>> = columns(data);
    delete content.prospectId;
    const { count } = await this.prisma.depotDraft.updateMany({
      where: { id, status: 'REJECTED' },
      data: { ...content, status: 'DRAFT', decisionNote: null, decidedBy: null, decidedAt: null },
    });
    if (count === 0) return null;
    return toRecord(await this.prisma.depotDraft.findUniqueOrThrow({ where: { id } }));
  }

  async list({ page, limit, status }: ListDepotDraftsFilter): Promise<{ items: DepotDraftRecord[]; total: number }> {
    const skip = (page - 1) * limit;
    if (status) {
      // One status: DRAFT oldest first (the stale ones surface), a decided one newest first.
      const where = { status };
      const [rows, total] = await this.prisma.$transaction([
        this.prisma.depotDraft.findMany({
          where,
          orderBy: [{ createdAt: status === 'DRAFT' ? 'asc' : 'desc' }, { id: 'asc' }],
          skip,
          take: limit,
        }),
        this.prisma.depotDraft.count({ where }),
      ]);
      return { items: rows.map(toRecord), total };
    }
    // Everything: the open drafts first, oldest first, then the decided ones, newest first. Two
    // orderings cannot share one ORDER BY, so the page window is cut across the two lists.
    const [open, decided] = await this.prisma.$transaction([
      this.prisma.depotDraft.count({ where: { status: 'DRAFT' } }),
      this.prisma.depotDraft.count({ where: { status: { not: 'DRAFT' } } }),
    ]);
    const fromOpen = Math.max(0, Math.min(limit, open - skip));
    const [first, rest] = await this.prisma.$transaction([
      this.prisma.depotDraft.findMany({
        where: { status: 'DRAFT' },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: Math.min(skip, open),
        take: fromOpen,
      }),
      this.prisma.depotDraft.findMany({
        where: { status: { not: 'DRAFT' } },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: Math.max(0, skip - open),
        take: limit - fromOpen,
      }),
    ]);
    return { items: [...first, ...rest].map(toRecord), total: open + decided };
  }

  async findById(id: string): Promise<DepotDraftRecord | null> {
    const row = await this.prisma.depotDraft.findUnique({ where: { id } });
    return row ? toRecord(row) : null;
  }

  async reject(id: string, note: string, decidedBy: string, at: Date): Promise<DepotDraftRecord | null> {
    const { count } = await this.prisma.depotDraft.updateMany({
      where: { id, status: 'DRAFT' },
      data: { status: 'REJECTED', decisionNote: note, decidedBy, decidedAt: at, ...CLEARED },
    });
    return count === 0 ? null : this.findById(id);
  }

  async activate(id: string, data: CreateDepotData, decidedBy: string, at: Date) {
    const { serviceArea, owners, ...rest } = data;
    const result = await this.prisma
      .$transaction(async (tx) => {
        const draft = await tx.depotDraft.findUnique({ where: { id } });
        if (!draft || draft.status !== 'DRAFT') return null;
        const depot = await tx.depot.create({
          data: {
            ...rest,
            crmProspectId: draft.prospectId,
            franchiseApplicationId: draft.legacyApplicationId,
            ...(owners && owners.length > 0
              ? { owners: { create: owners.map((o) => ({ ownerId: o.ownerId, sharePct: o.sharePct, isPrimary: o.isPrimary })) } }
              : {}),
            operatingHours: data.operatingHours as Prisma.InputJsonValue,
            holidays: data.holidays as unknown as Prisma.InputJsonValue,
            ...(serviceArea ? { serviceArea: serviceArea as unknown as Prisma.InputJsonValue } : {}),
          },
        });
        // Guarded again at the write: another activation or rejection that got in between loses.
        const { count } = await tx.depotDraft.updateMany({
          where: { id, status: 'DRAFT' },
          data: { status: 'ACTIVATED', depotId: depot.id, decidedBy, decidedAt: at, ...CLEARED },
        });
        if (count === 0) throw new DraftTakenError();
        const event = depotOnboarded({
          depotId: depot.id,
          depotCode: depot.code,
          prospectId: draft.prospectId,
          legacyApplicationId: draft.legacyApplicationId,
          occurredAt: at,
        });
        await tx.webhookEventOutbox.create({ data: { ...event, payload: event.payload as Prisma.InputJsonValue } });
        const done = await tx.depotDraft.findUniqueOrThrow({ where: { id } });
        return { draft: toRecord(done), depotId: depot.id, depotCode: depot.code };
      })
      .catch((e: unknown) => {
        if (e instanceof DraftTakenError) return null;
        if ((e as { code?: string })?.code === 'P2002') {
          // Only the unique index on depots.code is "that code is taken"; any other clash (an owner
          // row, the draft's own depotId) is a conflict with a concurrent write, never a raw 500.
          const target = (e as { meta?: { target?: unknown } }).meta?.target;
          const onCode = Array.isArray(target) ? target.length === 1 && target[0] === 'code' : target === 'depots_code_key';
          throw onCode ? new DuplicateDepotCodeError() : new DepotDraftConflictError();
        }
        throw e;
      });
    return result;
  }
}

/** Rolled back inside activate: the draft was decided by somebody else between the read and the write. */
class DraftTakenError extends Error {}
