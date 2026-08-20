import { DomainError, HTTP_STATUS } from '@hydromart/platform';

export class CampaignNotFoundError extends DomainError {
  readonly code = 'CAMPAIGN_NOT_FOUND';
  readonly status = HTTP_STATUS.NOT_FOUND;
  constructor() {
    super('Campaign not found.');
  }
}

export class CampaignNotDraftError extends DomainError {
  readonly code = 'CAMPAIGN_NOT_DRAFT';
  readonly status = HTTP_STATUS.CONFLICT;
  constructor() {
    super('Only a draft campaign can be sent.');
  }
}

export class NoRecipientsError extends DomainError {
  readonly code = 'CAMPAIGN_NO_RECIPIENTS';
  readonly status = HTTP_STATUS.UNPROCESSABLE;
  constructor() {
    super('A campaign needs at least one recipient.');
  }
}

export class BroadcastNotFoundError extends DomainError {
  readonly code = 'BROADCAST_NOT_FOUND';
  readonly status = HTTP_STATUS.NOT_FOUND;
  constructor() {
    super('Broadcast not found.');
  }
}

export class SegmentUnavailableError extends DomainError {
  readonly code = 'CAMPAIGN_SEGMENT_UNAVAILABLE';
  readonly status = HTTP_STATUS.UNPROCESSABLE;
  constructor(detail?: string) {
    super(`Could not resolve the audience segment${detail ? `: ${detail}` : ''}.`);
  }
}

/**
 * F1b: this recipient switched promotional messages off.
 *
 * Thrown rather than returned quietly so the sweep records the recipient FAILED with this
 * sentence beside their number — which is what staff who pasted a list need to see.
 * Follows the pattern already in the sweep for a number with no Hydromart account.
 *
 * Only reachable from an EXPLICIT recipient list: a segment-resolved audience never
 * contains an opted-out customer, because customer-service filters them out of the
 * directory query before the campaign is even created.
 */
export class RecipientOptedOutError extends DomainError {
  readonly code = 'CRM_RECIPIENT_OPTED_OUT';
  readonly status = 422;
  constructor() {
    super('pelanggan ini berhenti menerima info promo — tidak ada yang dikirim');
  }
}
