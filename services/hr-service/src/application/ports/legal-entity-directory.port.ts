export const LEGAL_ENTITY_DIRECTORY_PORT = Symbol('LegalEntityDirectoryPort');

/** What hr-service needs to know about a legal entity, which depot-service keeps. */
export interface LegalEntitySummary {
  id: string;
  name: string;
  kind: string;
  active: boolean;
}

export interface LegalEntityDirectoryPort {
  /**
   * The entity, or null when depot-service has none with that id. THROWS when depot-service
   * cannot answer: "I could not find out" must never read as "it exists" (an employee would be
   * dated to a company nobody checked) or as "it does not" (a valid save refused on a blip).
   */
  find(id: string): Promise<LegalEntitySummary | null>;
}
