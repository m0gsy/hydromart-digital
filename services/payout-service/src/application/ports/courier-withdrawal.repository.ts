import { WithdrawalStatus } from '../../domain/ledger';

export interface CourierWithdrawalRecord {
  id: string;
  courierId: string;
  amount: number;
  bankAccountRef: string;
  status: WithdrawalStatus;
  reference: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateCourierWithdrawalData {
  courierId: string;
  amount: number;
  bankAccountRef: string;
  reference: string;
  status: WithdrawalStatus;
}

export interface CourierWithdrawalRepository {
  create(data: CreateCourierWithdrawalData): Promise<CourierWithdrawalRecord>;
  listForCourier(courierId: string, limit: number): Promise<CourierWithdrawalRecord[]>;
}
