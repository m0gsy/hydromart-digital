import { Checklist, FranchiseAppStage } from '../../domain/franchise-application';

export interface FranchiseApplicationRecord {
  id: string;
  applicantName: string;
  applicantPhone: string;
  proposedCode: string;
  proposedName: string;
  city: string;
  province: string;
  lat: number;
  lng: number;
  investmentAmount: number;
  projectedMonthlyRevenue: number;
  checklist: Checklist;
  stage: FranchiseAppStage;
  submittedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateFranchiseApplicationData {
  applicantName: string;
  applicantPhone: string;
  proposedCode: string;
  proposedName: string;
  city: string;
  province: string;
  lat: number;
  lng: number;
  investmentAmount: number;
  projectedMonthlyRevenue: number;
  checklist: Checklist;
  stage?: FranchiseAppStage;
}

export interface UpdateFranchiseApplicationData {
  stage?: FranchiseAppStage;
  checklist?: Checklist;
}

export interface ListApplicationsFilter {
  page: number;
  limit: number;
  stage?: FranchiseAppStage;
}

export interface FranchiseApplicationRepository {
  create(data: CreateFranchiseApplicationData): Promise<FranchiseApplicationRecord>;
  /** Queue read: oldest-first by submittedAt (highest SLA age first). */
  list(filter: ListApplicationsFilter): Promise<{ items: FranchiseApplicationRecord[]; total: number }>;
  findById(id: string): Promise<FranchiseApplicationRecord | null>;
  update(id: string, patch: UpdateFranchiseApplicationData): Promise<FranchiseApplicationRecord>;
}
