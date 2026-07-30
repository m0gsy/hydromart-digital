import {
  AssetMovement,
  AssetMovementKind,
  AssetStatus,
  AssetType,
  EmployeeAsset,
  Prisma,
} from '../../../prisma/generated/client';

export const ASSET_REPOSITORY = Symbol('ASSET_REPOSITORY');

export interface AssetWrite {
  code: string;
  type: AssetType;
  name: string;
  brand: string | null;
  serialNo: string | null;
  value: Prisma.Decimal | number | null;
  depotId: string;
  note: string | null;
}

export interface AssetMovementWrite {
  assetId: string;
  kind: AssetMovementKind;
  fromEmployeeId: string | null;
  toEmployeeId: string | null;
  condition: string | null;
  note: string | null;
  createdBy: string | null;
}

export interface AssetListFilter {
  depotIds?: readonly string[];
  status?: AssetStatus;
  type?: AssetType;
  holderId?: string;
  skip: number;
  take: number;
}

export interface AssetRepository {
  create(data: AssetWrite): Promise<EmployeeAsset>;
  update(id: string, data: Partial<AssetWrite>): Promise<EmployeeAsset>;
  findById(id: string): Promise<EmployeeAsset | null>;
  list(filter: AssetListFilter): Promise<{ rows: EmployeeAsset[]; total: number }>;
  /**
   * Append the movement AND move the asset in one transaction. Split across two calls, a
   * crash between them leaves a log that disagrees with the item's status — and the log is
   * what an audit reads.
   */
  move(
    movement: AssetMovementWrite,
    next: { status: AssetStatus; holderId: string | null },
  ): Promise<EmployeeAsset>;
  listMovements(assetId: string): Promise<AssetMovement[]>;
}
