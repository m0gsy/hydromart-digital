import { Inject, Injectable } from '@nestjs/common';

import { ApiKeyEnvironment } from '../../domain/api-key-environment';
import { generateApiKey } from '../../domain/api-key-token';
import { ApiKeyNotFoundError, ApiKeyRevokedError } from '../../domain/errors';
import { ApiKeyRecord, ApiKeyRepository } from '../ports/api-key.repository';
import { ADMIN_TOKENS } from '../tokens';

export interface CreateApiKeyInput {
  name: string;
  scopes: string[];
  environment: ApiKeyEnvironment;
  /** ADM-5: days until the key stops working. Omitted = the default life below. */
  expiresInDays?: number;
}

/**
 * ADM-5 — how long a partner key lives when nobody says otherwise.
 *
 * A year is long enough that rotation is an annual chore rather than a weekly interruption,
 * and short enough that a key pasted into somebody's laptop in 2026 is not still opening
 * doors in 2031. The console can ask for less.
 */
const DEFAULT_LIFE_DAYS = 365;

const expiryFrom = (days: number, now = new Date()): Date =>
  new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

/** A created/rotated key plus its one-time-visible secret. */
export interface ApiKeyWithSecret {
  record: ApiKeyRecord;
  token: string;
}

@Injectable()
export class ApiKeyService {
  constructor(@Inject(ADMIN_TOKENS.ApiKeyRepository) private readonly repo: ApiKeyRepository) {}

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
      expiresAt: expiryFrom(input.expiresInDays ?? DEFAULT_LIFE_DAYS),
    });
    return { record, token };
  }

  /**
   * Rotate a key's secret in place; returns the new one-time secret. 404 if unknown.
   *
   * ADM-5: a REVOKED key cannot be rotated. Rotation used to clear `revokedAt`, so the
   * button that reads "rotate" quietly undid a revocation — the same partner got a working
   * credential back, and nothing on the screen said a security decision had been reversed.
   * Revoking is final; a partner who needs access again gets a new key, which is a decision
   * somebody makes on purpose.
   */
  async rotate(id: string, expiresInDays?: number): Promise<ApiKeyWithSecret> {
    // Keep the row's environment so the new prefix segment (live/test) still matches.
    // ponytail: list-and-find is fine for the handful of keys a network has.
    const existing = (await this.repo.list()).find((k) => k.id === id);
    if (!existing) throw new ApiKeyNotFoundError(id);
    if (existing.revokedAt) throw new ApiKeyRevokedError(id);
    const { token, keyPrefix, keyHash } = generateApiKey(existing.environment);
    const record = await this.repo.rotate(
      id,
      keyPrefix,
      keyHash,
      expiryFrom(expiresInDays ?? DEFAULT_LIFE_DAYS),
    );
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
