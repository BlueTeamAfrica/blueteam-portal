import "server-only";
import type { DocumentData } from "firebase-admin/firestore";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";

export type ResolvedPortalUser = {
  uid: string;
  tenantId: string;
  roleLower: string;
  clientId: string | null;
};

export async function requireBearerUid(req: Request): Promise<string> {
  const authHeader = req.headers.get("authorization") || "";
  const m = authHeader.match(/^Bearer (.+)$/);
  if (!m) {
    throw Object.assign(new Error("Missing Authorization Bearer token"), { status: 401 });
  }
  const decoded = await adminAuth().verifyIdToken(m[1]);
  return decoded.uid;
}

/**
 * Resolves tenant membership like the PDF route: deterministic userTenants id, then legacy query, then users/{uid}.
 */
export async function resolvePortalUserForTenant(
  uid: string,
  tenantId: string
): Promise<ResolvedPortalUser | null> {
  const db = adminDb();
  const membershipId = `${uid}_${tenantId}`;
  const memSnap = await db.collection("userTenants").doc(membershipId).get();
  if (memSnap.exists) {
    const mem = memSnap.data() as { role?: string; status?: string; clientId?: string };
    if (mem.status != null && mem.status !== "active") return null;
    const roleLower = String(mem.role ?? "").toLowerCase();
    if (!["owner", "admin", "client"].includes(roleLower)) return null;
    return {
      uid,
      tenantId,
      roleLower,
      clientId: mem.clientId ?? null,
    };
  }

  const legacySnap = await db
    .collection("userTenants")
    .where("userId", "==", uid)
    .where("tenantId", "==", tenantId)
    .limit(1)
    .get();
  if (!legacySnap.empty) {
    const mem = legacySnap.docs[0].data() as { role?: string; status?: string; clientId?: string };
    if (mem.status != null && mem.status !== "active") return null;
    const roleLower = String(mem.role ?? "").toLowerCase();
    if (!["owner", "admin", "client"].includes(roleLower)) return null;
    return {
      uid,
      tenantId,
      roleLower,
      clientId: mem.clientId ?? null,
    };
  }

  const userSnap = await db.collection("users").doc(uid).get();
  if (!userSnap.exists) return null;
  const u = userSnap.data() as { tenantId?: string; role?: string; clientId?: string };
  if (u.tenantId !== tenantId) return null;
  const roleLower = String(u.role ?? "").toLowerCase();
  if (!["owner", "admin", "client"].includes(roleLower)) return null;
  return {
    uid,
    tenantId,
    roleLower,
    clientId: u.clientId ?? null,
  };
}

export function canAccessNotificationData(ctx: ResolvedPortalUser, data: DocumentData): boolean {
  if (data.targetType === "user") return data.targetUserId === ctx.uid;
  if (data.targetType === "role") {
    const tr = String(data.targetRole ?? "").toLowerCase();
    if (tr !== ctx.roleLower) return false;
    if (tr === "client") {
      return data.clientId != null && data.clientId === ctx.clientId;
    }
    return true;
  }
  return false;
}
