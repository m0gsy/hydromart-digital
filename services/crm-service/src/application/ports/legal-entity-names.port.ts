/**
 * AI-7c: the name of each legal entity an AI access request names, asked of depot-service (the
 * entities live there). An id that is not an entity is absent from the answer. THROWS when
 * depot-service cannot answer, so a retry (not a vaguer message) is what follows.
 */
export interface LegalEntityNamesPort {
  namesOf(ids: readonly string[]): Promise<string[]>;
}
