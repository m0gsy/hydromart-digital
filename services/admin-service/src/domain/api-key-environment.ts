// Deployment target for an API key (Design 13d). Mirrors the Prisma ApiKeyEnvironment
// enum but kept domain-local so application/domain code never imports the generated client.
export enum ApiKeyEnvironment {
  PROD = 'PROD',
  STAGING = 'STAGING',
}
