import { randomBytes } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { WebhookNotFoundError } from '../../domain/errors';
import {
  CreateWebhookData,
  UpdateWebhookData,
  WebhookRecord,
  WebhookRepository,
} from '../ports/webhook.repository';
import { ADMIN_TOKENS } from '../tokens';

@Injectable()
export class WebhookService {
  constructor(@Inject(ADMIN_TOKENS.WebhookRepository) private readonly repo: WebhookRepository) {}

  /** All webhook endpoints (Design 19c), newest first. */
  list(): Promise<WebhookRecord[]> {
    return this.repo.list();
  }

  /**
   * CA-2-37: an endpoint registered without a secret is an endpoint nobody can trust.
   *
   * The dispatcher signs only when there IS one — deliberately, and its note says an
   * endpoint registered without a secret "asked for that". That premise was false: the HQ
   * console sends `{ url, events }` and has no field for a secret at all, so it could not
   * ask for anything. Every webhook ever registered from the console went out unsigned,
   * forever, and the receiver had no way to tell our POST from anyone else's — a URL is
   * not a credential, and anyone who learns it can forge deliveries.
   *
   * So one is generated when the caller does not supply one. An explicit secret is still
   * honoured: a partner migrating an endpoint that already verifies against a known key
   * must be able to keep it.
   *
   * 32 bytes of `randomBytes`, hex — the same shape the API keys in this service use, and
   * long enough that the HMAC is the weakest part rather than the key.
   */
  create(data: CreateWebhookData): Promise<WebhookRecord> {
    return this.repo.create({
      ...data,
      secret: data.secret?.trim() || randomBytes(32).toString('hex'),
    });
  }

  /** Toggle/edit an endpoint. 404 when the id is unknown. */
  async update(id: string, data: UpdateWebhookData): Promise<WebhookRecord> {
    const updated = await this.repo.update(id, data);
    if (!updated) throw new WebhookNotFoundError(id);
    return updated;
  }

  /** Delete an endpoint. 404 when the id is unknown. */
  async remove(id: string): Promise<void> {
    if (!(await this.repo.remove(id))) throw new WebhookNotFoundError(id);
  }
}
