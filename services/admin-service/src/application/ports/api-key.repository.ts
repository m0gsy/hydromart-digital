import { ApiKeyEnvironment } from '../../domain/api-key-environment';

export interface ApiKeyRecord {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  environment: ApiKeyEnvironment;
  lastUsedAt: Date | null;
  /** ADM-5: when this key stops working. Null = minted before keys had an end. */
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

/** Fields the repository persists on create/rotate (the hash never leaves the domain). */
export interface CreateApiKeyData {
  /** ADM-5: when the key stops working. */
  expiresAt?: Date | null;
  name: string;
  keyPrefix: string;
  keyHash: string;
  scopes: string[];
  environment: ApiKeyEnvironment;
}

export interface ApiKeyRepository {
  list(): Promise<ApiKeyRecord[]>;
  /** Authenticate a presented key by its hash. Null when unknown; revoked keys are returned
   *  so the guard can answer 401 rather than pretending the key never existed. */
  findByHash(keyHash: string): Promise<ApiKeyRecord | null>;
  /** Stamp a successful authentication. Best-effort — never blocks the request. */
  touchLastUsed(id: string, at: Date): Promise<void>;
  create(data: CreateApiKeyData): Promise<ApiKeyRecord>;
  /**
   * Replace prefix+hash for an existing key; null when the id is unknown.
   *
   * ADM-5: rotation does NOT clear `revokedAt` any more. It used to, so "rotate" on a key
   * somebody had deliberately revoked handed back a working credential for the same
   * partner — an undo of a security decision, spelled as routine maintenance.
   */
  rotate(
    id: string,
    keyPrefix: string,
    keyHash: string,
    expiresAt: Date | null,
  ): Promise<ApiKeyRecord | null>;
  /** Mark revoked (sets revokedAt); null when the id is unknown. */
  revoke(id: string): Promise<ApiKeyRecord | null>;
}
