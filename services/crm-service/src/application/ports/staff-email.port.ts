/** One staff notification's email, as crm hands it over. */
export interface StaffEmail {
  /** The accounts the notification is for: the same ones its push goes to. */
  accountIds: string[];
  /** The notification's switch: only accounts with its email on are written to. */
  toggle: string;
  subject: string;
  text: string;
  /** The screen the notification opens, relative to the web app. */
  path: string;
}

/**
 * The email channel of staff notifications. admin-service owns the switches, the addresses and
 * the SMTP, so crm only says who, under which switch, and what. THROWS when admin-service does
 * not take it; the caller logs that and carries on.
 */
export interface StaffEmailPort {
  send(email: StaffEmail): Promise<void>;
}
