import { Injectable } from '@nestjs/common';

import { HuddleActionItem, HuddleAgendaItem, HuddleNote } from '../../domain/huddle';
import {
  HuddleRepository,
  UpsertHuddleNoteData,
} from '../../application/ports/huddle.repository';
import { Prisma } from '../../../prisma/generated/client';
import { PrismaService } from './prisma.service';

interface HuddleNoteRow {
  id: string;
  depotId: string;
  weekStart: string;
  heldAt: Date;
  attendance: string | null;
  agenda: unknown;
  actionItems: unknown;
  recordedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class HuddlePrismaRepository implements HuddleRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toRecord(row: HuddleNoteRow): HuddleNote {
    return {
      ...row,
      agenda: (row.agenda ?? []) as HuddleAgendaItem[],
      actionItems: (row.actionItems ?? []) as HuddleActionItem[],
    };
  }

  async upsert(data: UpsertHuddleNoteData): Promise<HuddleNote> {
    const { depotId, weekStart, attendance, agenda, actionItems, recordedBy } = data;
    const agendaJson = agenda as unknown as Prisma.InputJsonValue;
    const actionItemsJson = actionItems as unknown as Prisma.InputJsonValue;
    const row = await this.prisma.huddleNote.upsert({
      where: { depotId_weekStart: { depotId, weekStart } },
      create: {
        depotId,
        weekStart,
        attendance,
        recordedBy,
        agenda: agendaJson,
        actionItems: actionItemsJson,
      },
      update: { attendance, recordedBy, agenda: agendaJson, actionItems: actionItemsJson },
    });
    return this.toRecord(row);
  }

  async findForWeek(depotId: string, weekStart: string): Promise<HuddleNote | null> {
    const row = await this.prisma.huddleNote.findUnique({
      where: { depotId_weekStart: { depotId, weekStart } },
    });
    return row ? this.toRecord(row) : null;
  }

  async listForDepot(depotId: string): Promise<HuddleNote[]> {
    const rows = await this.prisma.huddleNote.findMany({
      where: { depotId },
      orderBy: { weekStart: 'desc' },
    });
    return rows.map((r) => this.toRecord(r));
  }
}
