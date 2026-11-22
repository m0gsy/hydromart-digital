import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

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
    input: { employeeIds: string[]; legalEntityId: string; effectiveFrom: string },
    actorId: string | null,
  ): Promise<AssignedEmployee[]> {
    const day = parseCalendarDay(input.effectiveFrom);
    if (!day) throw new BadRequestException('effectiveFrom harus tanggal kalender (YYYY-MM-DD)');
    const entity = await this.entities.find(input.legalEntityId);
    if (!entity) throw new NotFoundException('Badan hukum tidak ditemukan');
    if (!entity.active) {
      throw new ConflictException('Badan hukum ini nonaktif. Aktifkan dulu, atau pilih badan hukum lain.');
    }
    const employeeIds = [...new Set(input.employeeIds)];
    if ((await this.points.existingEmployeeIds(employeeIds)).length !== employeeIds.length) {
      throw new NotFoundException('Karyawan tidak ditemukan');
    }
    return this.points.assign({
      employeeIds,
      legalEntityId: entity.id,
      effectiveFrom: day,
      recordedBy: actorId,
    });
  }

  /** Take back one dated point (entered by mistake); the period before it then runs on. */
  async remove(id: string): Promise<EmployeeLegalEntityPoint> {
    const removed = await this.points.remove(id);
    if (!removed) throw new NotFoundException('Riwayat badan hukum karyawan ini tidak ditemukan');
    return removed;
  }
}
