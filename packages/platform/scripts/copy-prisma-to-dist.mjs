// Postbuild helper. Copies a service's generated Prisma client into dist/ so the
// built `node dist/src/main.js` can resolve `../../../prisma/generated/client`.
//
// nest build never copies the generated client, and the import that resolves to
// `<svc>/prisma/generated/client` from src/ shifts to `<svc>/dist/prisma/generated/client`
// from dist/ (the extra `dist/` level moves the relative path up one). Without this
// copy the built artifact crashes at boot with "Cannot find module .../prisma/generated/client".
//
// Runs as each service's `postbuild` (cwd = the service dir). No-op for services
// with no service-local generated client (auth uses @prisma/client; gateway has no DB).
import { existsSync, cpSync } from 'node:fs';

const src = 'prisma/generated';
const dest = 'dist/prisma/generated';

if (existsSync(src)) {
  cpSync(src, dest, { recursive: true });
  console.log(`[postbuild] copied ${src} -> ${dest}`);
} else {
  console.log('[postbuild] no prisma/generated to copy (skipped)');
}
