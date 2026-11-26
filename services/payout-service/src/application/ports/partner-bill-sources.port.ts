import { EntitySpan, PartnerBillBank } from '../../domain/partner-bill';

/** What depot-service knows that a bill needs. Every method throws PartnerBillSourceUnavailableError when it cannot answer. */
export interface PartnerBillSources {
  /** Which entity each depot belonged to over [fromDay, toDay], as dated spans. */
  entityTimeline(depotIds: readonly string[], fromDay: string, toDay: string): Promise<EntitySpan[]>;
  /** The kind and name of each entity named (an unknown id is absent). */
  entities(ids: readonly string[]): Promise<{ id: string; name: string; kind: string }[]>;
  /** The franchisor's official account; null when none is entered. */
  officialAccount(): Promise<PartnerBillBank | null>;
  /** A depot's name and code for a line label and the report; throws when it cannot be read. */
  depot(depotId: string): Promise<{ name: string; code: string }>;
  /** The franchise-owner accounts of a depot on a day (ISO instant), from depot-service's ownership records. */
  ownersAsOf(depotId: string, asOfIso: string): Promise<string[]>;
}

export interface PartnerBillNotice {
  billId: string;
  month: string;
  monthLabel: string;
  legalEntityName: string;
  totalIdr: number;
  bank: PartnerBillBank;
  recipientIds: string[];
}

export interface PartnerBillVoidNotice {
  billId: string;
  monthLabel: string;
  legalEntityName: string;
  reason: string;
  recipientIds: string[];
}

/** crm-service files the in-app notice and email per owner; idempotent per (bill, owner). */
export interface PartnerBillNotifier {
  send(notice: PartnerBillNotice): Promise<void>;
  /** A sent bill was withdrawn: the owners it went to are told, once each. */
  sendVoid(notice: PartnerBillVoidNotice): Promise<void>;
}
