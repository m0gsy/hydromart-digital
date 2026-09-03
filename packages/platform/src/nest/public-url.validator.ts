import { registerDecorator, ValidationArguments, ValidationOptions } from 'class-validator';

/** Loopback, link-local and RFC-1918 ranges an outbound webhook must never reach. */
function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) {
    return true;
  }
  // IPv6 loopback / unique-local / link-local.
  if (host === '::1' || host === '::' || /^f[cd][0-9a-f]{2}:/.test(host) || /^fe80:/.test(host)) {
    return true;
  }
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!v4) {
    return false;
  }
  const [a, b] = v4.slice(1).map(Number);
  if (v4.slice(1).some((o) => Number(o) > 255)) {
    return true; // malformed dotted-quad — refuse rather than guess
  }
  return (
    a === 0 || // 0.0.0.0/8
    a === 127 || // loopback
    a === 10 || // RFC-1918
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) || // link-local / cloud metadata (169.254.169.254)
    (a === 100 && b >= 64 && b <= 127) // CGNAT
  );
}

/**
 * An absolute, externally reachable https URL — for outbound integrations the platform
 * itself will call (webhooks). Rejects:
 *
 *  - schemeless values (`partner.example.com/hooks`), which class-validator's @IsUrl
 *    accepts by default (`require_protocol` is false) and which resolve unpredictably;
 *  - non-https schemes, so a delivery is never sent in the clear;
 *  - loopback / RFC-1918 / link-local hosts, which turn a webhook into an SSRF probe
 *    against the cluster's own services and the cloud metadata endpoint.
 *
 * This is a literal-host check. It does NOT stop a public name that RESOLVES to a
 * private address (DNS rebinding) — that has to be enforced at call time, in the
 * webhook dispatcher, where the resolved address is known.
 */
export function IsPublicHttpsUrl(validationOptions?: ValidationOptions) {
  // eslint-disable-next-line @typescript-eslint/ban-types
  return function (object: Object, propertyName: string): void {
    registerDecorator({
      name: 'isPublicHttpsUrl',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          if (typeof value !== 'string') {
            return false;
          }
          let url: URL;
          try {
            url = new URL(value);
          } catch {
            return false; // relative or schemeless
          }
          if (url.protocol !== 'https:') {
            return false;
          }
          if (!url.hostname || !url.hostname.includes('.')) {
            return false; // bare host, no registrable domain
          }
          return !isPrivateHost(url.hostname);
        },
        defaultMessage(args: ValidationArguments): string {
          return `${args.property} harus URL https absolut ke host publik (bukan localhost/IP privat)`;
        },
      },
    });
  };
}
