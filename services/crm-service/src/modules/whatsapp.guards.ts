import { CanActivate, ExecutionContext, Injectable, NotFoundException, RawBodyRequest, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';

import { CrmConfigService } from '../config/crm-config.service';
import { verifyMetaSignature } from '../domain/wa-signature';

/**
 * While WhatsApp is off (WA_ENABLED blank, or its keys incomplete) the route does not exist: 404, so a scan
 * of the public host learns nothing and nothing is processed.
 */
@Injectable()
export class WaReadyGuard implements CanActivate {
  constructor(private readonly config: CrmConfigService) {}

  canActivate(): boolean {
    if (!this.config.whatsapp.ready) throw new NotFoundException();
    return true;
  }
}

/** Meta's webhook POST: the signature over the raw body, or nothing is processed. */
@Injectable()
export class MetaSignatureGuard implements CanActivate {
  constructor(private readonly config: CrmConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<RawBodyRequest<Request>>();
    const header = req.headers['x-hub-signature-256'];
    if (!verifyMetaSignature(this.config.whatsapp.appSecret, req.rawBody, typeof header === 'string' ? header : undefined)) {
      throw new UnauthorizedException();
    }
    return true;
  }
}
