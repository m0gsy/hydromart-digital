export interface RefreshTokenRecord {
  id: string;
  customerId: string;
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedById: string | null;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: Date;
}

export interface CreateRefreshTokenData {
  customerId: string;
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
  userAgent: string | null;
  ipAddress: string | null;
  /**
   * CA-2-06: when this token was minted, stamped by the APPLICATION.
   *
   * The column defaults to `now()` in the database, which was fine while nothing read it.
   * The idle-session limit does read it — and comparing a database timestamp against the
   * application's clock makes a security decision rest on the skew between two machines.
   * The service that measures the interval is the one that stamps both ends of it.
   */
  createdAt: Date;
}

/** Persistence port for refresh-token sessions. */
export interface RefreshTokenRepository {
  create(data: CreateRefreshTokenData): Promise<RefreshTokenRecord>;
  findByTokenHash(tokenHash: string): Promise<RefreshTokenRecord | null>;
  /** Mark a token revoked, optionally recording which token replaced it. */
  revoke(id: string, at: Date, replacedById?: string): Promise<void>;
  /** Revoke every non-revoked token in a rotation family (theft response). */
  revokeFamily(familyId: string, at: Date): Promise<void>;
  /** Revoke all active sessions for a customer (logout-all, FR-010). */
  revokeAllForCustomer(customerId: string, at: Date): Promise<void>;
  /** Active (non-revoked, non-expired) sessions for a customer. */
  listActiveForCustomer(customerId: string, now: Date): Promise<RefreshTokenRecord[]>;
}
