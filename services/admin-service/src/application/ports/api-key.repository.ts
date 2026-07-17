import { ApiKeyEnvironment } from '../../domain/api-key-environment';

export interface ApiKeyRecord {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  environment: ApiKeyEnvironment;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

/** Fields the repository persists on create/rotate (the hash never leaves the domain). */
export interface CreateApiKeyData {
  name: string;
  keyPrefix: string;
  keyHash: string;
  scopes: string[];
  environment: ApiKeyEnvironment;
}

export interface ApiKeyRepository {
  list(): Promise<ApiKeyRecord[]>;
  create(data: CreateApiKeyData): Promise<ApiKeyRecord>;
  /** Replace prefix+hash for an existing key; null when the id is unknown or revoked. */
  rotate(id: string, keyPrefix: string, keyHash: string): Promise<ApiKeyRecord | null>;
  /** Mark revoked (sets revokedAt); null when the id is unknown. */
  revoke(id: string): Promise<ApiKeyRecord | null>;
}
