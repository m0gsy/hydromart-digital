import { PartnerBillBank, PartnerBillBasis, PartnerBillRecord, PartnerBillStatus } from '../../domain/partner-bill';

export interface NewPartnerBill {
  legalEntityId: string;
  legalEntityName: string;
  month: string;
  totalIdr: number;
  lines: { depotId: string; label: string; amountIdr: number; basis: PartnerBillBasis }[];
}

export interface PartnerBillRepository {
  /** The live (not VOID) bill of an entity for a month, with no lines. */
  findLive(legalEntityId: string, month: string): Promise<PartnerBillRecord | null>;
  /** Null when another run made the same live bill first (the partial unique index). */
  create(data: NewPartnerBill): Promise<PartnerBillRecord | null>;
  findById(id: string): Promise<PartnerBillRecord | null>;
  list(
    filter: { month?: string; legalEntityId?: string; status?: PartnerBillStatus },
    limit: number,
  ): Promise<PartnerBillRecord[]>;
  /** SENT bills that name this owner, and the sent ones later voided (so the owner sees why), newest month first. */
  listForOwner(ownerId: string, limit: number): Promise<PartnerBillRecord[]>;
  /** DRAFT or SENDING -> SENDING (the retry of a failed send); null when it is anything else. */
  beginSend(id: string): Promise<PartnerBillRecord | null>;
  /** SENDING -> SENT, only if still SENDING; null when somebody got there first. */
  markSent(
    id: string,
    data: { approvedBy: string; recipientIds: string[]; bank: PartnerBillBank },
  ): Promise<PartnerBillRecord | null>;
  /** DRAFT or SENT -> VOID with its reason; null when it is VOID, SENDING or gone. */
  markVoid(id: string, reason: string): Promise<PartnerBillRecord | null>;
}
