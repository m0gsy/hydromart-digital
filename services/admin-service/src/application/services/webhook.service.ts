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
  constructor(
    @Inject(ADMIN_TOKENS.WebhookRepository) private readonly repo: WebhookRepository,
  ) {}

  /** All webhook endpoints (Design 19c), newest first. */
  list(): Promise<WebhookRecord[]> {
    return this.repo.list();
  }

  create(data: CreateWebhookData): Promise<WebhookRecord> {
    return this.repo.create(data);
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
