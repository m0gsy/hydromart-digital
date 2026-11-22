import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { AuditService } from './audit.service';
import {
  AssignedEmployee,
  EMPLOYEE_LEGAL_ENTITY_REPOSITORY,
  EmployeeLegalEntityRepository,
} from '../ports/employee-legal-entity.repository';
import {
  LEGAL_ENTITY_DIRECTORY_PORT,
  LegalEntityDirectoryPort,
} from '../ports/legal-entity-directory.port';
import {
  EmployeeLegalEntityHistory,
  EmployeeLegalEntityPoint,
  parseCalendarDay,
} from '../../domain/legal-entity';

/** A UUID as Postgres prints it. The DTOs accept either case; text comparisons must not care. */
const lowerId = (id: string): string => id.toLowerCase();

/**
 * HD-5: which legal entity employs each person, by date. Head office enters it on
 * /hq/legal-entities. Nothing in hr-service reads it yet: payroll, attendance and the jabatan
 * role are exactly as before; the AI read API (HD-6) is its first reader.
 */
@Injectable()
export class EmployeeLegalEntityService {
  constructor(
    @Inject(EMPLOYEE_LEGAL_ENTITY_REPOSITORY) private readonly points: EmployeeLegalEntityRepository,
    @Inject(LEGAL_ENTITY_DIRECTORY_PORT) private readonly entities: LegalEntityDirectoryPort,
    private readonly audit: AuditService,
  ) {}

  histories(): Promise<EmployeeLegalEntityHistory[]> {
    return this.points.histories();
  }

  /**
   * From `effectiveFrom`, these employees work for this entity. The entity must exist and be
   * active in depot-service; when depot-service cannot say, the save is refused (503) rather
   * than dated to a company nobody checked.
   */
  async assign(
    input: {
      employeeIds: string[];
      legalEntityId: string;
      effectiveFrom: string;
      /** The entity the screen showed on that day, for each employee that had a point there. */
      seen: ReadonlyArray<{ id: string; legalEntityId: string }>;
    },
    actorId: string | null,
  ): Promise<AssignedEmployee[]> {
    const day = parseCalendarDay(input.effectiveFrom);
    if (!day) throw new BadRequestException('effectiveFrom harus tanggal kalender (YYYY-MM-DD)');
    const entity = await this.entities.find(lowerId(input.legalEntityId));
    if (!entity) throw new NotFoundException('Badan hukum tidak ditemukan');
    if (!entity.active) {
      throw new ConflictException('Badan hukum ini nonaktif. Aktifkan dulu, atau pilih badan hukum lain.');
    }
    // UUIDs are compared as text below (locks, what the screen saw): one spelling, the database's.
    const employeeIds = [...new Set(input.employeeIds.map(lowerId))];
    if ((await this.points.existingEmployeeIds(employeeIds)).length !== employeeIds.length) {
      throw new NotFoundException('Karyawan tidak ditemukan');
    }
    const written = await this.points.assign({
      employeeIds,
      legalEntityId: entity.id,
      effectiveFrom: day,
      recordedBy: actorId,
      seen: new Map(input.seen.map((s) => [lowerId(s.id), lowerId(s.legalEntityId)])),
    });
    // The request interceptor keeps the body, not what a corrected day held before: said here.
    if (written.length > 0) {
      await this.audit.record({
        actorId,
        action: 'employee_legal_entity.assign',
        entity: 'employee-legal-entities',
        entityId: entity.id,
        before: {
          replaced: written
            .filter((w) => w.replaced)
            .map((w) => ({ employeeId: w.employeeId, legalEntityId: w.replaced })),
        },
        after: {
          legalEntityId: entity.id,
          effectiveFrom: input.effectiveFrom,
          employeeIds: written.map((w) => w.employeeId),
        },
        ip: null,
      });
    }
    return written;
  }

  /**
   * Take back one dated point (entered by mistake); the period before it then runs on. The caller
   * names the entity its screen showed on that point: a point corrected since is not deleted blind.
   */
  async remove(id: string, seenLegalEntityId: string, actorId: string | null): Promise<EmployeeLegalEntityPoint> {
    const removed = await this.points.remove(id, lowerId(seenLegalEntityId));
    if (!removed) throw new NotFoundException('Riwayat badan hukum karyawan ini tidak ditemukan');
    // The row is gone after this: what it held is only in the trail.
    await this.audit.record({
      actorId,
      action: 'employee_legal_entity.remove',
      entity: 'employee-legal-entities',
      // Keyed like the assign rows: by the legal entity, the employee is in `before`.
      entityId: removed.legalEntityId,
      before: removed,
      after: null,
      ip: null,
    });
    return removed;
  }
}
