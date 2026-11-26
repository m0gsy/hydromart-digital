import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { DepotChecklist, DepotDraftRecord } from '../../domain/depot-draft';
import { DepotDraftRepository, NewDepotDraft } from '../../application/ports/depot-draft.repository';
import { PrismaService } from './prisma.service';

type Row = Awaited<ReturnType<PrismaService['depotDraft']['findUniqueOrThrow']>>;

const toRecord = (r: Row): DepotDraftRecord => ({ ...r, checklist: r.checklist as unknown as DepotChecklist });

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
}
