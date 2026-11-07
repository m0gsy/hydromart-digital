// AUT-03: one implementation. This file used to carry its own copy that took the first
// x-forwarded-for hop from ANY peer, so the caller chose the address written into the login
// audit trail and the session record. The shared version only believes the header when the
// socket peer is one of ours (a private address), exactly as every other service does.
export { getRequestContext } from '@hydromart/platform';
