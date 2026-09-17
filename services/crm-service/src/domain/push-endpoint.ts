/**
 * CRM-6 — which push endpoints this service will ever POST to.
 *
 * The endpoint arrives from the device, and the web-push sender makes an HTTPS request to
 * whatever it says. As a free string that was a blind request to a host of the caller's
 * choosing, from inside the network. A real subscription only ever points at a browser
 * vendor's push service, or is an FCM token (`fcm:<token>`, which never becomes a URL).
 */
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^(updates\.)?push\.services\.mozilla\.com$/,
  /^([a-z0-9-]+\.)*notify\.windows\.com$/,
  /^([a-z0-9-]+\.)*push\.apple\.com$/,
];

export function isAllowedPushEndpoint(endpoint: string): boolean {
  if (endpoint.startsWith('fcm:')) return endpoint.length > 4 && !/\s/.test(endpoint);
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.port !== '' || url.username || url.password) return false;
  return PUSH_HOSTS.some((host) => host.test(url.hostname.toLowerCase()));
}
