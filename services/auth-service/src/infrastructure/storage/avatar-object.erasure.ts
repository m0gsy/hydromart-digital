import { ErasureExecutor, ErasureSubject } from '../../application/ports/erasure-executor.port';
import { CustomerRepository } from '../../application/ports/customer.repository';
import { StoragePort, avatarKeyFromUrl } from '../../application/ports/storage.port';

/**
 * AUTH-2 — the avatar PHOTO, not just the column that points at it.
 *
 * `anonymisedIdentity` nulls `avatarUrl`, and that was the whole of it: the face stayed in
 * the bucket, at a URL that had been handed out in every profile response. A dataset in the
 * registry rather than a line in the service, so a bucket that refuses the delete is
 * reported FAILED in the coverage and the request stays re-runnable.
 *
 * Runs before `anonymiseCustomer` (the registry fan-out always does), which is the only
 * moment the URL can still be read.
 */
export class AvatarObjectErasure implements ErasureExecutor {
  readonly dataset = 'auth.avatar_objects';
  readonly configured = true;

  constructor(
    private readonly customers: CustomerRepository,
    private readonly storage: StoragePort,
  ) {}

  async erase(subject: ErasureSubject): Promise<number> {
    const account = await this.customers.findById(subject.customerId);
    const key = avatarKeyFromUrl(account?.avatarUrl ?? null);
    if (!key) return 0;
    await this.storage.remove(key);
    return 1;
  }
}
