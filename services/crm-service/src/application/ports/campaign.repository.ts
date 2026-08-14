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
  /** When it becomes due. NULL = immediately, which is what every pre-scheduling row meant. */
  scheduledFor: Date | null;
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
  /** When it becomes due. Absent/null = immediately, the pre-scheduling behaviour. */
  scheduledFor?: Date | null;
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
  /**
   * Claim a DRAFT campaign for dispatch. Conditional on `status: DRAFT` in the WHERE, so
   * two simultaneous sends cannot both pass a read-then-write check and double-broadcast
   * to real customers (B-17). False = somebody else already claimed it.
   */
  markSending(id: string): Promise<boolean>;
  /** Campaigns still mid-broadcast, oldest first, for the sweep to continue. */
  findSending(limit: number, now: Date): Promise<CampaignRecord[]>;
  /**
   * Claim up to `limit` PENDING recipients of one campaign by moving them to SENDING, and
   * return only the rows this call actually moved. The claim is the WHERE clause: a
   * concurrent sweep tick reads back nothing and messages nobody twice.
   */
  claimRecipients(campaignId: string, limit: number): Promise<CampaignRecipientRecord[]>;
  /** How many of a campaign's recipients are in each terminal/queue state. */
  tally(campaignId: string): Promise<{ pending: number; sent: number; failed: number }>;
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
