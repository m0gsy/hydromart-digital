import { createSign } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';

import { PushPayload, PushSenderPort } from '../../application/ports/push-sender.port';
import { WebPushSubscriptionRecord } from '../../application/ports/push.repository';
import { CrmConfigService } from '../../config/crm-config.service';

/**
 * Firebase Cloud Messaging HTTP v1, written by hand against `node:crypto`.
 *
 * Not `firebase-admin`: that package is ~50 MB of transitive dependencies and a
 * Google-Cloud-wide surface, for one POST and one OAuth exchange. The repo already
 * hand-rolls its VAPID keygen and its web-push signing for the same reason, and the
 * whole of it fits below.
 *
 * An Android device registers as `fcm:<token>` in the same `endpoint` column a browser
 * subscription uses. That prefix is not laziness about the schema — `pending_migrations()`
 * in `deploy-common.sh` enforces the convention that a column ships one release BEFORE
 * the code reading it, so a new model would be two releases where a prefix is one. The
 * same trick is already in use for water-meter units. The cost is a table whose name is
 * now only half true, paid for with a comment in the schema.
 */
export const FCM_PREFIX = 'fcm:';

const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
/** Google issues one-hour tokens; re-mint a minute early so none is spent in flight. */
const TOKEN_SKEW_SECONDS = 60;
const REQUEST_TIMEOUT_MS = 10_000;

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

@Injectable()
export class FcmSenderAdapter implements PushSenderPort {
  private readonly logger = new Logger(FcmSenderAdapter.name);
  private readonly enabled: boolean;
  private readonly projectId: string;
  private readonly clientEmail: string;
  private readonly privateKey: string;

  /** Cached OAuth access token; `expiresAt` is epoch seconds. */
  private token: { value: string; expiresAt: number } | null = null;

  constructor(config: CrmConfigService) {
    const { projectId, clientEmail, privateKey } = config.fcm;
    this.projectId = projectId;
    this.clientEmail = clientEmail;
    this.privateKey = privateKey;
    // Same fail-open shape as VAPID: unset credentials disable the transport rather than
    // stopping the service from booting. Without this, CI (which has no Firebase project)
    // could not start crm-service at all.
    this.enabled = Boolean(projectId && clientEmail && privateKey);
    if (!this.enabled) {
      this.logger.warn(
        'FCM credentials not set; Android push disabled (notifications still stored).',
      );
    }
  }

  /** Whether this adapter owns the endpoint — the composite sender's routing question. */
  static owns(endpoint: string): boolean {
    return endpoint.startsWith(FCM_PREFIX);
  }

  async send(
    sub: WebPushSubscriptionRecord,
    payload: PushPayload,
  ): Promise<{ ok: boolean; gone?: boolean }> {
    if (!this.enabled) return { ok: false };
    const deviceToken = sub.endpoint.slice(FCM_PREFIX.length);
    if (!deviceToken) return { ok: false, gone: true };

    const accessToken = await this.accessToken();
    if (!accessToken) return { ok: false };

    try {
      const res = await this.post(
        `https://fcm.googleapis.com/v1/projects/${this.projectId}/messages:send`,
        { Authorization: `Bearer ${accessToken}` },
        {
          message: {
            token: deviceToken,
            notification: { title: payload.title, body: payload.body },
            // Data values must be strings — FCM rejects the whole message otherwise, and
            // the click handler reads `url` from here.
            data: payload.url ? { url: payload.url } : {},
          },
        },
      );

      if (res.status === 200) return { ok: true };
      if (this.isUnregistered(res)) return { ok: false, gone: true };
      // A 401 means the cached token was rejected; drop it so the next send re-mints.
      if (res.status === 401) this.token = null;
      this.logger.warn(`FCM send failed (${res.status}) for ${sub.endpoint.slice(0, 24)}…`);
      return { ok: false };
    } catch (e) {
      this.logger.warn(`FCM send failed: ${(e as Error).message}`);
      return { ok: false };
    }
  }

  /**
   * A device that uninstalled the app or whose token rotated. FCM says so two ways and
   * both have to be read, because only one of them prunes the row: a 404 with
   * `UNREGISTERED`, or a 400 `INVALID_ARGUMENT` on a token that is no longer a token.
   * Treating every 4xx as "gone" would delete good subscriptions on a bad payload.
   */
  private isUnregistered(res: { status: number; body: unknown }): boolean {
    if (res.status !== 404 && res.status !== 400) return false;
    const error = (res.body as { error?: { status?: string; details?: { errorCode?: string }[] } })
      ?.error;
    if (error?.status === 'NOT_FOUND') return true;
    return (error?.details ?? []).some((d) => d?.errorCode === 'UNREGISTERED');
  }

  /** Mint (or reuse) an OAuth access token from the service account's key. */
  private async accessToken(): Promise<string | null> {
    const now = Math.floor(Date.now() / 1000);
    if (this.token && this.token.expiresAt > now) return this.token.value;

    const claims = {
      iss: this.clientEmail,
      scope: FCM_SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    };
    const signingInput = `${base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64url(
      JSON.stringify(claims),
    )}`;

    let assertion: string;
    try {
      const signer = createSign('RSA-SHA256');
      signer.update(signingInput);
      assertion = `${signingInput}.${signer.sign(this.privateKey, 'base64url')}`;
    } catch (e) {
      // A malformed key is a configuration error, not a per-message failure — say so
      // once per send rather than letting it look like a network problem.
      this.logger.error(`FCM private key is unusable: ${(e as Error).message}`);
      return null;
    }

    try {
      const res = await this.post(
        TOKEN_URL,
        { 'content-type': 'application/x-www-form-urlencoded' },
        new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion,
        }),
      );
      const body = res.body as { access_token?: string; expires_in?: number } | undefined;
      if (res.status !== 200 || !body?.access_token) {
        this.logger.warn(`FCM token exchange failed (${res.status}).`);
        return null;
      }
      this.token = {
        value: body.access_token,
        expiresAt: now + (body.expires_in ?? 3600) - TOKEN_SKEW_SECONDS,
      };
      return this.token.value;
    } catch (e) {
      this.logger.warn(`FCM token exchange failed: ${(e as Error).message}`);
      return null;
    }
  }

  /** One POST with a deadline. `fetch` has none, and a hung Google is not a reason to hang. */
  private async post(
    url: string,
    headers: Record<string, string>,
    body: unknown,
  ): Promise<{ status: number; body: unknown }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const form = body instanceof URLSearchParams;
      const res = await fetch(url, {
        method: 'POST',
        headers: form ? headers : { ...headers, 'content-type': 'application/json' },
        body: form ? body.toString() : JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await res.text();
      let parsed: unknown;
      try {
        parsed = text ? JSON.parse(text) : undefined;
      } catch {
        parsed = undefined;
      }
      return { status: res.status, body: parsed };
    } finally {
      clearTimeout(timer);
    }
  }
}
