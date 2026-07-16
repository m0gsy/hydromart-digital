import { DomainError, HTTP_STATUS } from '@hydromart/platform';

export class FeatureFlagNotFoundError extends DomainError {
  readonly code = 'FEATURE_FLAG_NOT_FOUND';
  readonly status = HTTP_STATUS.NOT_FOUND;
  constructor(key: string) {
    super(`Feature flag "${key}" not found.`);
  }
}
