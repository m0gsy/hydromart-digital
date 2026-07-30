import { Injectable } from '@nestjs/common';

import { EmployeeDocument, EmployeeDocumentType } from '../../../prisma/generated/client';
import {
  DocumentRepository,
  DocumentWrite,
  PurgeableDocument,
} from '../../application/ports/document.repository';
import { PrismaService } from './prisma.service';

@Injectable()
export class DocumentPrismaRepository implements DocumentRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: DocumentWrite): Promise<EmployeeDocument> {
    return this.prisma.employeeDocument.create({ data });
  }

  findById(id: string): Promise<EmployeeDocument | null> {
    return this.prisma.employeeDocument.findUnique({ where: { id } });
  }

  listByEmployee(employeeId: string): Promise<EmployeeDocument[]> {
    return this.prisma.employeeDocument.findMany({
      where: { employeeId },
      orderBy: [{ type: 'asc' }, { version: 'desc' }],
    });
  }

  findCurrent(employeeId: string, type: EmployeeDocumentType): Promise<EmployeeDocument | null> {
    return this.prisma.employeeDocument.findFirst({
      where: { employeeId, type, supersededById: null },
      orderBy: { version: 'desc' },
    });
  }

  async markSuperseded(id: string, supersededById: string): Promise<void> {
    await this.prisma.employeeDocument.update({ where: { id }, data: { supersededById } });
  }

  listPurgeable(cutoff: Date): Promise<PurgeableDocument[]> {
    // Same dormancy rule as the employee retention report: departed staff whose record has
    // not been touched since before the cutoff. ACTIVE staff are never in scope.
    return this.prisma.employeeDocument.findMany({
      where: {
        employee: { status: { in: ['RESIGNED', 'INACTIVE'] }, updatedAt: { lt: cutoff } },
      },
      select: { id: true, fileKey: true },
    });
  }

  async deleteMany(ids: string[]): Promise<number> {
    const { count } = await this.prisma.employeeDocument.deleteMany({
      where: { id: { in: ids } },
    });
    return count;
  }
}
