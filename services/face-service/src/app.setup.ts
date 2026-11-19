import { type INestApplication, VersioningType } from '@nestjs/common';
import helmet from 'helmet';

import { configureBodyLimits } from './http/body-limits';

/**
 * Everything about the HTTP surface that is not a route: the parsers, the headers, the
 * `/api/v1` prefix. One function, so the HTTP spec runs what production runs.
 */
export function configureApp(app: INestApplication): void {
  configureBodyLimits(app);
  app.use(helmet());
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
}
