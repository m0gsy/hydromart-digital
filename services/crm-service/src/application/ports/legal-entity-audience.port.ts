/**
 * AI-26: who may read a legal entity's calon mitra CRM in the AI web, asked of depot-service
 * (the entities and their AI grants live there). Null = not an entity. THROWS when depot-service
 * cannot answer, so a retry (not a vaguer notice) is what follows.
 */
export interface LegalEntityAudiencePort {
  audienceOf(id: string): Promise<{ name: string; active: boolean; aiReadRoles: string[] } | null>;
}
