// Broadcast channel.
//
// IN_APP is the only value anything writes now: a campaign is delivered as a row in the
// customer's in-app inbox plus best-effort push, the same path every transactional
// notification takes. WHATSAPP remains in the enum because campaigns sent before the
// switch carry it, and rewriting history to say they went somewhere else would be the
// same kind of lie this change removed.
export enum CampaignChannel {
  WHATSAPP = 'WHATSAPP',
  IN_APP = 'IN_APP',
}
