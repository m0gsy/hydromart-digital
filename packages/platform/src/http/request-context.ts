import { Request } from 'express';

import { RequestContext } from './authenticated-user';

/** Extract caller IP and user-agent for audit logging and records. */
export function getRequestContext(request: Request): RequestContext {
  const forwarded = request.headers['x-forwarded-for'];
  const forwardedIp = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0]?.trim();
  return {
    ipAddress: forwardedIp || request.ip || request.socket.remoteAddress || null,
    userAgent: request.headers['user-agent'] ?? null,
  };
}
