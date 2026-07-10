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

export class SegmentUnavailableError extends DomainError {
  readonly code = 'CAMPAIGN_SEGMENT_UNAVAILABLE';
  readonly status = HTTP_STATUS.UNPROCESSABLE;
  constructor(detail?: string) {
    super(`Could not resolve the audience segment${detail ? `: ${detail}` : ''}.`);
  }
}
