/**
 * Resolves plan id for tenants/{tenantId}/planPermissions/{planId}.
 * Mirrors firestore.rules getBillingPlanId() so UI and rules stay aligned.
 * Only string/number scalars count — object-shaped `plan` fields would produce invalid paths.
 */
function safeBillingPlanSegment(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") {
    const t = v.trim();
    return t !== "" ? t : null;
  }
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

/** Accepts portal tenant context or any tenant-shaped map (mirrors firestore.rules getBillingPlanId). */
export function getBillingPlanIdFromTenant(tenant: Record<string, unknown> | null | undefined): string {
  if (!tenant) return "starter";
  const sub = tenant.subscription as { plan?: unknown } | undefined;
  const fromSub = safeBillingPlanSegment(sub?.plan);
  if (fromSub != null) return fromSub;
  const fromPlan = safeBillingPlanSegment(tenant.plan);
  if (fromPlan != null) return fromPlan;
  const fromBill = safeBillingPlanSegment(tenant.billingPlanId);
  if (fromBill != null) return fromBill;
  return "starter";
}
