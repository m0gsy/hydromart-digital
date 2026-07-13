import { WithdrawalRecord, WithdrawalStatus } from '../../domain/ledger';

export interface CreateWithdrawalData {
  franchiseOwnerId: string;
  amount: number;
  bankAccountRef: string;
  reference: string;
  status: WithdrawalStatus;
}

export interface WithdrawalRepository {
  create(data: CreateWithdrawalData): Promise<WithdrawalRecord>;
  listForOwner(franchiseOwnerId: string, limit: number): Promise<WithdrawalRecord[]>;
}
