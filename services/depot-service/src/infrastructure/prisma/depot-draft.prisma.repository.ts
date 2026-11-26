import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { DepotChecklist, depotOnboarded, DepotDraftRecord } from '../../domain/depot-draft';
import { DuplicateDepotCodeError } from '../../domain/errors';
import { CreateDepotData } from '../../application/ports/depot.repository';
import {
  DepotDraftRepository,
  ListDepotDraftsFilter,
  NewDepotDraft,
} from '../../application/ports/depot-draft.repository';
import { PrismaService } from './prisma.service';

type Row = Awaited<ReturnType<PrismaService['depotDraft']['findUniqueOrThrow']>>;

const toRecord = (r: Row): DepotDraftRecord => ({ ...r, checklist: r.checklist as unknown as DepotChecklist });

/** UU PDP: the owner's name and phone are not kept past the decision. */
const CLEARED = { ownerFullName: null, ownerPhoneE164: null } as const;

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
    const where = status ? { status } : {};
    // DRAFT first, then the decided ones; newest first within each. A status sorts by its position
    // in the enum (DRAFT, ACTIVATED, REJECTED), which puts DRAFT first without a second query.
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.depotDraft.findMany({
        where,
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.depotDraft.count({ where }),
    ]);
    return { items: rows.map(toRecord), total };
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
        if ((e as { code?: string })?.code === 'P2002' && String((e as { meta?: { target?: unknown } }).meta?.target ?? '').includes('code')) {
          throw new DuplicateDepotCodeError();
        }
        throw e;
      });
    return result;
  }
}

/** Rolled back inside activate: the draft was decided by somebody else between the read and the write. */
class DraftTakenError extends Error {}
