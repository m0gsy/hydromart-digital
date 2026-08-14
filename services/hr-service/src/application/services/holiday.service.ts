import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AuthenticatedUser, assertDepotAccess, depotScopeIds } from '@hydromart/platform';

import { Holiday, Prisma } from '../../../prisma/generated/client';
import { HOLIDAY_REPOSITORY, HolidayRepository } from '../ports/holiday.repository';

/** Non-working calendar days. depotIds null = national. Read = hrView; write = hrAdmin. */
@Injectable()
export class HolidayService {
  constructor(@Inject(HOLIDAY_REPOSITORY) private readonly repo: HolidayRepository) {}

  async list(
    user: AuthenticatedUser,
    query: { depotId?: string; from?: string; to?: string },
  ): Promise<Holiday[]> {
    const depotIds = depotScopeIds(user, query.depotId);
    return this.repo.list({
      depotIds,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
    });
  }

  async create(
    user: AuthenticatedUser,
    input: { date: string; name: string; depotId?: string },
  ): Promise<Holiday> {
    // A national holiday (no depotIds) is SUPER_ADMIN/HQ territory; a depot-scoped one is
    // limited to the caller's depot.
    if (input.depotId) assertDepotAccess(user, input.depotId);
    try {
      return await this.repo.create({
        date: new Date(input.date),
        name: input.name,
        depotId: input.depotId ?? null,
      });
    } catch (err) {
      // (date, depotId) is unique. Planting a holiday that is already there is the operator
      // being right, not the server breaking — it used to surface as a bare 500 with the
      // Prisma stack in the log and nothing usable on screen.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Tanggal ini sudah terdaftar sebagai hari libur');
      }
      throw err;
    }
  }

  async remove(user: AuthenticatedUser, id: string): Promise<void> {
    const holiday = await this.repo.findById(id);
    if (!holiday) throw new NotFoundException('Hari libur tidak ditemukan');
    if (holiday.depotId) assertDepotAccess(user, holiday.depotId);
    await this.repo.delete(id);
  }
}
