import { CampaignChannel } from '../../domain/channel';
import { CampaignStatus } from '../../domain/campaign-status';
import { RecipientStatus } from '../../domain/recipient-status';

export interface CampaignRecipientRecord {
  id: string;
  campaignId: string;
  customerId: string | null;
  phone: string;
  name: string | null;
  status: RecipientStatus;
  error: string | null;
  sentAt: Date | null;
  createdAt: Date;
}

export interface CampaignRecord {
  id: string;
  name: string;
  channel: CampaignChannel;
  messageTemplate: string;
  status: CampaignStatus;
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  sentAt: Date | null;
  recipients: CampaignRecipientRecord[];
}

/** A recipient from the explicit staff-supplied list (customerId + name optional). */
export interface CreateRecipientData {
  customerId?: string | null;
  phone: string;
  name?: string | null;
}

export interface CreateCampaignData {
  createdBy: string;
  name: string;
  messageTemplate: string;
  recipients: CreateRecipientData[];
}

export interface CampaignRepository {
  /** Persist a DRAFT campaign and its PENDING recipients atomically ($transaction). */
  create(data: CreateCampaignData): Promise<CampaignRecord>;
  /** Load a campaign with its recipients, or null if it does not exist. */
  findById(id: string): Promise<CampaignRecord | null>;
  /** Load just the recipients for a campaign. */
  findByIdRecipients(id: string): Promise<CampaignRecipientRecord[]>;
  /** Paginated campaign list (recipients omitted from list items). */
  list(page: number, limit: number): Promise<{ items: CampaignRecord[]; total: number }>;
  /** Flip a campaign to SENDING before dispatch. */
  markSending(id: string): Promise<void>;
  /** Record a single recipient's delivery outcome. */
  recordRecipientResult(
    recipientId: string,
    status: RecipientStatus,
    error: string | null,
    sentAt: Date | null,
  ): Promise<void>;
  /** Flip a campaign to SENT and store the final sent/failed counts + sentAt. */
  finalize(
    id: string,
    sentCount: number,
    failedCount: number,
    sentAt: Date,
  ): Promise<CampaignRecord>;
}
