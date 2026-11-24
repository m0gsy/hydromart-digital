/** One plain-text message to one person: never a list of other people's addresses. */
export interface StaffMail {
  to: string;
  subject: string;
  text: string;
}

/** Sends one staff email. THROWS with the transport's reason when it cannot; the caller counts it. */
export interface StaffMailer {
  send(mail: StaffMail): Promise<void>;
}
