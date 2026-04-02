import "server-only";
import { adminDb } from "@/lib/firebaseAdmin";

export type TenantAdminMember = { uid: string; role: string };

/**
 * Portal staff (owner/admin) for a tenant via userTenants (field userId, not uid).
 */
export async function getTenantAdmins(tenantId: string): Promise<TenantAdminMember[]> {
  const db = adminDb();
  const snap = await db.collection("userTenants").where("tenantId", "==", tenantId).get();
  const out: TenantAdminMember[] = [];
  for (const doc of snap.docs) {
    const role = String(doc.get("role") ?? "").trim().toLowerCase();
    if (role !== "owner" && role !== "admin") continue;
    const uid = doc.get("userId") as string | undefined;
    if (!uid) continue;
    const status = String(doc.get("status") ?? "active").trim().toLowerCase();
    if (status && status !== "active") continue;
    out.push({ uid, role });
  }
  return out;
}

export type ClientPortalUser = { uid: string; email: string | null; clientId: string | null; tenantId: string | null };

/**
 * Firebase Auth users linked to a client record within a tenant.
 */
export async function getClientUsers(clientId: string, tenantId: string): Promise<ClientPortalUser[]> {
  const db = adminDb();
  const snap = await db
    .collection("users")
    .where("clientId", "==", clientId)
    .where("tenantId", "==", tenantId)
    .get();

  return snap.docs.map((doc) => ({
    uid: doc.id,
    email: (doc.get("email") as string | undefined) ?? null,
    clientId: (doc.get("clientId") as string | undefined) ?? null,
    tenantId: (doc.get("tenantId") as string | undefined) ?? null,
  }));
}
