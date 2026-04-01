/**
 * Canonical client id: Firestore document id at tenants/{tenantId}/clients/{clientId}.
 * Client portal access requires users/{uid}.clientId to equal this value on linked services (and matching queries).
 */
export function isCanonicalClientId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value === value.trim();
}
