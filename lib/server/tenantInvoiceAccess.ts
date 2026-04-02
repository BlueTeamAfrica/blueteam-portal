import "server-only";
import { adminDb } from "@/lib/firebaseAdmin";
import { getBillingPlanIdFromTenant } from "@/lib/tenantBillingPlan";

/** Owner/admin for tenant: deterministic userTenants doc or users/{uid} fallback (portal staff). */
export async function assertStaffCanManageInvoices(uid: string, tenantId: string): Promise<void> {
  const db = adminDb();
  const memId = `${uid}_${tenantId}`;
  const memSnap = await db.collection("userTenants").doc(memId).get();
  if (memSnap.exists) {
    const mem = memSnap.data() as { role?: string; status?: string };
    if (mem.status === "active" && (mem.role === "owner" || mem.role === "admin")) {
      return;
    }
  }

  const legacySnap = await db
    .collection("userTenants")
    .where("userId", "==", uid)
    .where("tenantId", "==", tenantId)
    .limit(1)
    .get();
  if (!legacySnap.empty) {
    const mem = legacySnap.docs[0].data() as { role?: string; status?: string };
    if (mem.status !== "active") {
      throw Object.assign(new Error("Not authorized"), { status: 403 });
    }
    if (mem.role === "owner" || mem.role === "admin") {
      return;
    }
  }

  const userSnap = await db.collection("users").doc(uid).get();
  if (userSnap.exists) {
    const u = userSnap.data() as { tenantId?: string; role?: string };
    const r = String(u.role ?? "").toLowerCase();
    if (u.tenantId === tenantId && (r === "owner" || r === "admin")) {
      return;
    }
  }

  throw Object.assign(new Error("Not authorized"), { status: 403 });
}

/** Same staff gate as invoicing (owner/admin for tenant). */
export async function assertStaffCanManageServices(uid: string, tenantId: string): Promise<void> {
  await assertStaffCanManageInvoices(uid, tenantId);
}

export async function assertTenantAllowsInvoiceCreate(tenantId: string): Promise<void> {
  const db = adminDb();
  const tSnap = await db.collection("tenants").doc(tenantId).get();
  const tenant = tSnap.exists ? { id: tenantId, ...tSnap.data() } : { id: tenantId };
  const planId = getBillingPlanIdFromTenant(tenant as Record<string, unknown>);
  const permSnap = await db.collection("tenants").doc(tenantId).collection("planPermissions").doc(planId).get();
  const allowed = !permSnap.exists || permSnap.data()?.canInvoices !== false;
  if (!allowed) {
    throw Object.assign(new Error("Invoicing is not enabled for this plan"), { status: 403 });
  }
}
