import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { AI_TOKEN_AUDIENCE, MACHINE_TOKEN_AUDIENCE } from '@hydromart/platform';

import { AuthConfigService } from '../../config/auth-config.service';
import { machineSecretLive } from '../../config/external-access';
import { Role } from '../../domain/customer/role.enum';
import {
  ExternalTokensOffError,
  HandoffBusyError,
  HandoffNotForCustomersError,
  InvalidHandoffCodeError,
  InvalidMachineCredentialsError,
} from '../../domain/errors/auth.errors';
import { ExternalTokenSigner } from '../../infrastructure/security/external-token-signer';
import { ClockPort } from '../ports/clock.port';
import { CustomerRepository } from '../ports/customer.repository';
import { RequestContext } from '../results';
import { AUTH_TOKENS } from '../tokens';
import { AuditAction, AuditService } from './audit.service';

/** A handoff code lives 60 seconds and is spent on first use (Plan Eksekusi section 4). */
export const HANDOFF_CODE_TTL_SECONDS = 60;
/** AI-web and machine tokens live 15 minutes; there is no refresh token, only a new handoff. */
export const EXTERNAL_TOKEN_TTL_SECONDS = 900;
const MAX_PENDING_CODES = 1_000;

export interface ExternalTokenResult {
  tokenType: 'Bearer';
  accessToken: string;
  expiresIn: number;
}

interface PendingCode {
  customerId: string;
  codeChallenge: string;
  expiresAt: number;
}

const sha256 = (value: string): Buffer => createHash('sha256').update(value).digest();

/** Constant-time equality for two strings that are equal length when they match at all. */
function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * HD-3: the two ways an ES256 token is issued.
 *
 * Handoff (a person, through the AI web). The AI web starts it with a PKCE challenge; the
 * person's hydromart-digital session asks for a code bound to that challenge; the AI web's
 * server trades the code and the verifier for a token carrying the person's OWN role. A
 * stolen code is useless without the verifier, which never left the AI web.
 *
 * Machine accounts (n8n). An id and a secret, configured in MACHINE_ACCOUNTS, traded for a
 * token whose `scopes` are that account's closed capability list and nothing else.
 */
@Injectable()
export class ExternalAccessService {
  /*
   * ponytail: pending codes live in this process. auth-service runs as one container; a
   * second replica would not know codes the first minted, which fails closed (the person
   * starts the sign-in again). Move them to the database if auth-service is ever scaled out.
   */
  private readonly pending = new Map<string, PendingCode>();

  constructor(
    @Inject(AUTH_TOKENS.CustomerRepository) private readonly customers: CustomerRepository,
    @Inject(AUTH_TOKENS.ClockPort) private readonly clock: ClockPort,
    private readonly signer: ExternalTokenSigner,
    private readonly audit: AuditService,
    private readonly config: AuthConfigService,
  ) {}

  /** Step 2 of a handoff: the signed-in person's session asks for a code for this challenge. */
  async issueHandoffCode(
    caller: { sub: string; role: string },
    codeChallenge: string,
    context: RequestContext,
  ): Promise<{ code: string; expiresIn: number }> {
    this.assertOn();
    if (caller.role === Role.CUSTOMER) throw new HandoffNotForCustomersError();

    const now = this.clock.now().getTime();
    for (const [key, entry] of this.pending) {
      if (entry.expiresAt <= now) this.pending.delete(key);
    }
    if (this.pending.size >= MAX_PENDING_CODES) throw new HandoffBusyError();

    const code = randomBytes(32).toString('base64url');
    this.pending.set(sha256(code).toString('hex'), {
      customerId: caller.sub,
      codeChallenge,
      expiresAt: now + HANDOFF_CODE_TTL_SECONDS * 1000,
    });
    await this.audit.record({
      customerId: caller.sub,
      action: AuditAction.HANDOFF_CODE_ISSUED,
      success: true,
      ...context,
    });
    return { code, expiresIn: HANDOFF_CODE_TTL_SECONDS };
  }

  /** Step 3: the AI web's server trades the code and its PKCE verifier for a token. */
  async exchangeHandoffCode(
    code: string,
    codeVerifier: string,
    context: RequestContext,
  ): Promise<ExternalTokenResult> {
    this.assertOn();
    const key = sha256(code).toString('hex');
    const entry = this.pending.get(key);
    // Spent on first presentation, right verifier or wrong: a code someone else is trying
    // is a code the person has to start over for, never one that can be tried again.
    this.pending.delete(key);
    const now = this.clock.now();

    const challenge = sha256(codeVerifier).toString('base64url');
    if (!entry || entry.expiresAt <= now.getTime() || !sameText(challenge, entry.codeChallenge)) {
      await this.audit.record({
        customerId: entry?.customerId ?? null,
        action: AuditAction.HANDOFF_FAILED,
        success: false,
        ...context,
        metadata: { reason: !entry ? 'unknown' : entry.expiresAt <= now.getTime() ? 'expired' : 'verifier' },
      });
      throw new InvalidHandoffCodeError();
    }

    // Read again, not carried in the code: a suspension or role change in those 60 seconds
    // is what the token says.
    const customer = await this.customers.findById(entry.customerId);
    if (!customer) throw new InvalidHandoffCodeError();
    customer.ensureCanAuthenticate();
    if (customer.role === Role.CUSTOMER) throw new HandoffNotForCustomersError();

    const accessToken = this.signer.sign(
      {
        aud: AI_TOKEN_AUDIENCE,
        sub: customer.id,
        role: customer.role,
        depotId: customer.assignedDepotId,
      },
      EXTERNAL_TOKEN_TTL_SECONDS,
      now,
    );
    await this.audit.record({
      customerId: customer.id,
      action: AuditAction.HANDOFF_EXCHANGED,
      success: true,
      ...context,
    });
    return { tokenType: 'Bearer', accessToken, expiresIn: EXTERNAL_TOKEN_TTL_SECONDS };
  }

  /** A machine account trades its id and secret for a token carrying its closed scopes. */
  async issueMachineToken(
    accountId: string,
    secret: string,
    context: RequestContext,
  ): Promise<ExternalTokenResult> {
    this.assertOn();
    const now = this.clock.now();
    const presented = sha256(secret).toString('hex');
    // Every entry is compared, so the time taken does not say which id exists.
    let account = null;
    for (const candidate of this.config.machineAccounts) {
      if (sameText(candidate.secretSha256, presented) && candidate.id === accountId) {
        account = candidate;
      }
    }
    if (!account || !machineSecretLive(account, now)) {
      await this.audit.record({
        customerId: null,
        action: AuditAction.MACHINE_TOKEN_FAILED,
        success: false,
        ...context,
        metadata: { accountId, reason: account ? 'expired' : 'credentials' },
      });
      throw new InvalidMachineCredentialsError();
    }

    const accessToken = this.signer.sign(
      { aud: MACHINE_TOKEN_AUDIENCE, sub: account.id, scopes: account.scopes },
      EXTERNAL_TOKEN_TTL_SECONDS,
      now,
    );
    await this.audit.record({
      customerId: account.id,
      action: AuditAction.MACHINE_TOKEN_ISSUED,
      success: true,
      ...context,
      metadata: { name: account.name, scopes: account.scopes, notAfter: account.notAfter.toISOString() },
    });
    return { tokenType: 'Bearer', accessToken, expiresIn: EXTERNAL_TOKEN_TTL_SECONDS };
  }

  private assertOn(): void {
    if (!this.signer.enabled) throw new ExternalTokensOffError();
  }
}
