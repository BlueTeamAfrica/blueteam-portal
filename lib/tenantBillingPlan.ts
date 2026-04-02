/**
 * Resolves plan id for tenants/{tenantId}/planPermissions/{planId}.
 * Mirrors firestore.rules getBillingPlanId() so UI and rules stay aligned.
 */
/** Accepts portal tenant context or any tenant-shaped map (mirrors firestore.rules getBillingPlanId). */
export function getBillingPlanIdFromTenant(tenant: Record<string, unknown> | null | undefined): string {
  if (!tenant) return "starter";
  const sub = tenant.subscription as { plan?: unknown } | undefined;
  if (sub?.plan != null && String(sub.plan).trim() !== "") return String(sub.plan);
  if (tenant.plan != null && String(tenant.plan).trim() !== "") return String(tenant.plan);
  if (tenant.billingPlanId != null && String(tenant.billingPlanId).trim() !== "")
    return String(tenant.billingPlanId);
  return "starter";
}
