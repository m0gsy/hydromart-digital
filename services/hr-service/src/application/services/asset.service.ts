import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuthenticatedUser, ImportSummary, assertDepotAccess, depotScopeFilter, runImport } from '@hydromart/platform';

import {
  AssetMovement,
  AssetMovementKind,
  AssetStatus,
  AssetType,
  EmployeeAsset,
  Prisma,
} from '../../../prisma/generated/client';
import { applyAssetMove, assetMoveError } from '../../domain/asset';
import { ASSET_REPOSITORY, AssetRepository } from '../ports/asset.repository';
import { EmployeeService } from './employee.service';

export interface CreateAssetInput {
  code: string;
  type: AssetType;
  name: string;
  depotId: string;
  brand?: string;
  serialNo?: string;
  value?: number;
  note?: string;
}

export interface UpdateAssetInput {
  name?: string;
  brand?: string;
  serialNo?: string;
  value?: number;
  note?: string;
}

export interface MoveAssetInput {
  kind: AssetMovementKind;
  toEmployeeId?: string;
  condition?: string;
  note?: string;
}

export interface AssetListQuery {
  depotId?: string;
  status?: AssetStatus;
  type?: AssetType;
  holderId?: string;
  page?: number;
  pageSize?: number;
}

/**
 * Company property handed to staff. The asset row carries only the *current* state; how it
 * got there is the AssetMovement log, which is append-only — "who had the motorcycle in
 * March, and what condition did it come back in" has to stay answerable after the fact.
 */
@Injectable()
export class AssetService {
  constructor(
    @Inject(ASSET_REPOSITORY) private readonly repo: AssetRepository,
    private readonly employees: EmployeeService,
  ) {}

  async list(
    user: AuthenticatedUser,
    query: AssetListQuery = {},
  ): Promise<{ rows: EmployeeAsset[]; total: number }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    return this.repo.list({
      depotId: depotScopeFilter(user, query.depotId) ?? undefined,
      status: query.status,
      type: query.type,
      holderId: query.holderId,
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
  }

  /** The asset plus its full hand-over history — the tab in the employee detail reads this. */
  async getById(
    user: AuthenticatedUser,
    id: string,
  ): Promise<EmployeeAsset & { movements: AssetMovement[] }> {
    const asset = await this.get(id);
    assertDepotAccess(user, asset.depotId);
    return { ...asset, movements: await this.repo.listMovements(id) };
  }

  async create(user: AuthenticatedUser, input: CreateAssetInput): Promise<EmployeeAsset> {
    assertDepotAccess(user, input.depotId);
    try {
      return await this.repo.create({
        code: input.code.trim().toUpperCase(),
        type: input.type,
        name: input.name,
        depotId: input.depotId,
        brand: input.brand ?? null,
        serialNo: input.serialNo ?? null,
        value: input.value === undefined ? null : new Prisma.Decimal(input.value),
        note: input.note ?? null,
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Kode aset sudah dipakai');
      }
      throw err;
    }
  }

  /**
   * Bulk import (CSV wizard): register the asset, then hand it to whoever already holds it
   * so the opening state matches the depot floor. The hand-over goes through `move`, not a
   * direct write, so the movement log starts on day one like every other transfer.
   *
   * A registered asset whose hand-over fails stays `created` with the reason attached —
   * downgrading it to `failed` would say the asset does not exist, and the re-upload would
   * then be rejected as a duplicate code.
   */
  async importMany(
    user: AuthenticatedUser,
    rows: (CreateAssetInput & { holderEmployeeCode?: string })[],
  ): Promise<ImportSummary> {
    return runImport(
      rows,
      async ({ holderEmployeeCode, ...input }) => {
        const asset = await this.create(user, input);
        if (!holderEmployeeCode) return { status: 'created', id: asset.id };
        try {
          const holder = await this.employees.getByCode(user, holderEmployeeCode);
          await this.move(user, asset.id, {
            kind: 'ASSIGN',
            toEmployeeId: holder.id,
            note: 'Import data awal',
          });
          return { status: 'created', id: asset.id };
        } catch (err) {
          const reason = err instanceof Error ? err.message : 'penerima tidak valid';
          return {
            status: 'created',
            id: asset.id,
            message: `Aset terdaftar, belum diserahkan: ${reason}`,
          };
        }
      },
      // An asset code that already exists is a re-upload, not a failure.
      (err) => err instanceof ConflictException && String(err.message).includes('Kode aset'),
    );
  }

  /**
   * Descriptive fields only. Status and holder are deliberately absent: moving an asset
   * without appending to the log is exactly the hole this module exists to close.
   */
  async update(
    user: AuthenticatedUser,
    id: string,
    input: UpdateAssetInput,
  ): Promise<EmployeeAsset> {
    const asset = await this.get(id);
    assertDepotAccess(user, asset.depotId);
    return this.repo.update(id, {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.brand !== undefined ? { brand: input.brand } : {}),
      ...(input.serialNo !== undefined ? { serialNo: input.serialNo } : {}),
      ...(input.value !== undefined ? { value: new Prisma.Decimal(input.value) } : {}),
      ...(input.note !== undefined ? { note: input.note } : {}),
    });
  }

  /** The single door state moves through. Every legal move appends a row. */
  async move(user: AuthenticatedUser, id: string, input: MoveAssetInput): Promise<EmployeeAsset> {
    const asset = await this.get(id);
    assertDepotAccess(user, asset.depotId);

    const recipient = input.toEmployeeId ?? null;
    const error = assetMoveError(asset.status, input.kind, recipient);
    if (error) throw new ConflictException(error);

    if (recipient) {
      const employee = await this.employees.getById(user, recipient);
      if (employee.depotId !== asset.depotId) {
        // An asset belongs to a depot's books. Handing it across depots without moving the
        // asset itself would leave one depot short of an item it is still accountable for.
        throw new BadRequestException('Karyawan penerima berada di depot lain');
      }
    }

    const next = applyAssetMove(input.kind, recipient);
    return this.repo.move(
      {
        assetId: asset.id,
        kind: input.kind,
        fromEmployeeId: asset.holderId,
        toEmployeeId: recipient,
        condition: input.condition ?? null,
        note: input.note ?? null,
        createdBy: user.sub,
      },
      next,
    );
  }

  private async get(id: string): Promise<EmployeeAsset> {
    const asset = await this.repo.findById(id);
    if (!asset) throw new NotFoundException('Aset tidak ditemukan');
    return asset;
  }
}
