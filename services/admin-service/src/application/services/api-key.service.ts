import { Inject, Injectable } from '@nestjs/common';

import { ApiKeyEnvironment } from '../../domain/api-key-environment';
import { generateApiKey } from '../../domain/api-key-token';
import { ApiKeyNotFoundError } from '../../domain/errors';
import { ApiKeyRecord, ApiKeyRepository } from '../ports/api-key.repository';
import { ADMIN_TOKENS } from '../tokens';

export interface CreateApiKeyInput {
  name: string;
  scopes: string[];
  environment: ApiKeyEnvironment;
}

/** A created/rotated key plus its one-time-visible secret. */
export interface ApiKeyWithSecret {
  record: ApiKeyRecord;
  token: string;
}

@Injectable()
export class ApiKeyService {
  constructor(
    @Inject(ADMIN_TOKENS.ApiKeyRepository) private readonly repo: ApiKeyRepository,
  ) {}

  /** All keys (Design 13d), newest first. Never exposes the secret or its hash. */
  list(): Promise<ApiKeyRecord[]> {
    return this.repo.list();
  }

  /** Mint a new key; the full secret is returned ONCE and only the prefix+hash persist. */
  async create(input: CreateApiKeyInput): Promise<ApiKeyWithSecret> {
    const { token, keyPrefix, keyHash } = generateApiKey(input.environment);
    const record = await this.repo.create({
      name: input.name,
      keyPrefix,
      keyHash,
      scopes: input.scopes,
      environment: input.environment,
    });
    return { record, token };
  }

  /** Rotate a key's secret in place; returns the new one-time secret. 404 if unknown. */
  async rotate(id: string): Promise<ApiKeyWithSecret> {
    // Keep the row's environment so the new prefix segment (live/test) still matches.
    // ponytail: list-and-find is fine for the handful of keys a network has.
    const existing = (await this.repo.list()).find((k) => k.id === id);
    if (!existing) throw new ApiKeyNotFoundError(id);
    const { token, keyPrefix, keyHash } = generateApiKey(existing.environment);
    const record = await this.repo.rotate(id, keyPrefix, keyHash);
    if (!record) throw new ApiKeyNotFoundError(id);
    return { record, token };
  }

  /** Revoke a key (sets revokedAt). 404 if unknown. */
  async revoke(id: string): Promise<ApiKeyRecord> {
    const record = await this.repo.revoke(id);
    if (!record) throw new ApiKeyNotFoundError(id);
    return record;
  }
}
