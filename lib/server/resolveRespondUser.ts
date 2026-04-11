import "server-only";
import { adminDb } from "@/lib/firebaseAdmin";

export type ResolvedRespondUser = {
  role: string;
  clientId: string | null;
  /** How membership was resolved (for logs / debug). */
  source: "userTenants_composite" | "userTenants_query" | "users_doc";
};

export type ResolveRespondUserTrace = {
  tenantId: string;
  uid: string;
  steps: string[];
  compositeDocId: string;
  compositeExists: boolean;
  compositeSkipReason?: string;
  legacyUserIdTenantCount: number;
  legacyUidTenantCount: number;
  scanByUserIdCount: number;
  scanByUserIdMatchedTenant: number;
  scanByUidFieldCount: number;
  scanByUidFieldMatchedTenant: number;
  usersDocExists: boolean;
  usersDocTenantId?: string | null;
  usersDocRole?: string | null;
  resolvedSource?: ResolvedRespondUser["source"];
  resolvedRole?: string | null;
};

function isActiveMembershipStatus(status: unknown): boolean {
  if (status == null || status === "") return true;
  return String(status).toLowerCase() === "active";
}

type ParseSource = "composite" | "query";

function tryParseMembership(
  raw: Record<string, unknown>,
  tenantId: string,
  source: ParseSource
): { ok: Omit<ResolvedRespondUser, "source"> } | { fail: string } {
  const memTenant = raw.tenantId != null ? String(raw.tenantId).trim() : "";
  if (memTenant && memTenant !== tenantId) {
    return { fail: "tenant_field_mismatch" };
  }
  if (!isActiveMembershipStatus(raw.status)) {
    return { fail: `inactive_status:${String(raw.status ?? "")}` };
  }
  const roleLower = String(raw.role ?? "").toLowerCase();
  if (!["owner", "admin", "client"].includes(roleLower)) {
    return { fail: `role_not_allowed:${roleLower || "empty"}` };
  }
  const rawCid = raw.clientId;
  const cid = rawCid != null ? String(rawCid).trim() : "";
  return { ok: { role: roleLower, clientId: cid || null } };
}

function attachSource(
  parsed: Omit<ResolvedRespondUser, "source">,
  source: ResolvedRespondUser["source"]
): ResolvedRespondUser {
  return { ...parsed, source };
}

/**
 * Resolves portal user for client service respond: owner | admin | client.
 * Does not assume a single userTenants document id or field naming.
 */
export async function resolveRespondUser(
  uid: string,
  tenantId: string
): Promise<{ user: ResolvedRespondUser | null; trace: ResolveRespondUserTrace }> {
  const db = adminDb();
  const trace: ResolveRespondUserTrace = {
    tenantId,
    uid,
    steps: [],
    compositeDocId: `${uid}_${tenantId}`,
    compositeExists: false,
    legacyUserIdTenantCount: 0,
    legacyUidTenantCount: 0,
    scanByUserIdCount: 0,
    scanByUserIdMatchedTenant: 0,
    scanByUidFieldCount: 0,
    scanByUidFieldMatchedTenant: 0,
    usersDocExists: false,
  };

  const push = (s: string) => {
    trace.steps.push(s);
  };

  // 1a) Composite id uid_tenantId (rules / portal convention)
  const compositeIdPrimary = `${uid}_${tenantId}`;
  let memSnap = await db.collection("userTenants").doc(compositeIdPrimary).get();
  trace.compositeDocId = compositeIdPrimary;
  trace.compositeExists = memSnap.exists;
  if (memSnap.exists) {
    const parsed = tryParseMembership(memSnap.data() as Record<string, unknown>, tenantId, "composite");
    if ("ok" in parsed) {
      push("composite_uid_tenant:accepted");
      trace.resolvedSource = "userTenants_composite";
      trace.resolvedRole = parsed.ok.role;
      const user = attachSource(parsed.ok, "userTenants_composite");
      console.log("[resolveRespondUser]", { ...trace, found: "composite_uid_tenant" });
      return { user, trace };
    }
    trace.compositeSkipReason = parsed.fail;
    push(`composite_uid_tenant:skipped(${parsed.fail})`);
  } else {
    push("composite_uid_tenant:missing");
  }

  // 1b) Alternate composite tenant_uid (seen in some imports)
  const compositeIdAlt = `${tenantId}_${uid}`;
  if (compositeIdAlt !== compositeIdPrimary) {
    memSnap = await db.collection("userTenants").doc(compositeIdAlt).get();
    if (memSnap.exists) {
      trace.compositeExists = true;
      const parsed = tryParseMembership(memSnap.data() as Record<string, unknown>, tenantId, "composite");
      if ("ok" in parsed) {
        push("composite_tenant_uid:accepted");
        trace.compositeDocId = compositeIdAlt;
        trace.compositeSkipReason = undefined;
        trace.resolvedSource = "userTenants_composite";
        trace.resolvedRole = parsed.ok.role;
        const user = attachSource(parsed.ok, "userTenants_composite");
        console.log("[resolveRespondUser]", { ...trace, found: "composite_tenant_uid" });
        return { user, trace };
      }
      push(`composite_tenant_uid:skipped(${parsed.fail})`);
    } else {
      push("composite_tenant_uid:missing");
    }
  }

  // 2) Compound queries (efficient when indexes exist)
  try {
    const legUser = await db
      .collection("userTenants")
      .where("userId", "==", uid)
      .where("tenantId", "==", tenantId)
      .limit(5)
      .get();
    trace.legacyUserIdTenantCount = legUser.size;
    push(`query_userId+tenant:${legUser.size}`);
    for (const d of legUser.docs) {
      const parsed = tryParseMembership(d.data() as Record<string, unknown>, tenantId, "query");
      if ("ok" in parsed) {
        push("query_userId+tenant:accepted");
        trace.resolvedSource = "userTenants_query";
        trace.resolvedRole = parsed.ok.role;
        console.log("[resolveRespondUser]", { ...trace, found: "query_userId_tenant", docId: d.id });
        return { user: attachSource(parsed.ok, "userTenants_query"), trace };
      }
    }
  } catch (e) {
    push(`query_userId+tenant:error:${(e as Error).message}`);
  }

  try {
    const legUid = await db
      .collection("userTenants")
      .where("uid", "==", uid)
      .where("tenantId", "==", tenantId)
      .limit(5)
      .get();
    trace.legacyUidTenantCount = legUid.size;
    push(`query_uid+tenant:${legUid.size}`);
    for (const d of legUid.docs) {
      const parsed = tryParseMembership(d.data() as Record<string, unknown>, tenantId, "query");
      if ("ok" in parsed) {
        push("query_uid+tenant:accepted");
        trace.resolvedSource = "userTenants_query";
        trace.resolvedRole = parsed.ok.role;
        console.log("[resolveRespondUser]", { ...trace, found: "query_uid_tenant", docId: d.id });
        return { user: attachSource(parsed.ok, "userTenants_query"), trace };
      }
    }
  } catch (e) {
    push(`query_uid+tenant:error:${(e as Error).message}`);
  }

  // 3) Arbitrary doc ids: scan by user id field variants, filter tenant in memory
  const scanLimit = 80;
  try {
    const byUserId = await db.collection("userTenants").where("userId", "==", uid).limit(scanLimit).get();
    trace.scanByUserIdCount = byUserId.size;
    for (const d of byUserId.docs) {
      const data = d.data() as Record<string, unknown>;
      const tid = String(data.tenantId ?? "").trim();
      if (tid !== tenantId) continue;
      trace.scanByUserIdMatchedTenant += 1;
      const parsed = tryParseMembership(data, tenantId, "query");
      if ("ok" in parsed) {
        push(`scan_userId:accepted doc:${d.id}`);
        trace.resolvedSource = "userTenants_query";
        trace.resolvedRole = parsed.ok.role;
        console.log("[resolveRespondUser]", { ...trace, found: "scan_userId", docId: d.id });
        return { user: attachSource(parsed.ok, "userTenants_query"), trace };
      }
    }
    push(`scan_userId:no_valid(${byUserId.size} docs)`);
  } catch (e) {
    push(`scan_userId:error:${(e as Error).message}`);
  }

  try {
    const byUidField = await db.collection("userTenants").where("uid", "==", uid).limit(scanLimit).get();
    trace.scanByUidFieldCount = byUidField.size;
    for (const d of byUidField.docs) {
      const data = d.data() as Record<string, unknown>;
      const tid = String(data.tenantId ?? "").trim();
      if (tid !== tenantId) continue;
      trace.scanByUidFieldMatchedTenant += 1;
      const parsed = tryParseMembership(data, tenantId, "query");
      if ("ok" in parsed) {
        push(`scan_uid_field:accepted doc:${d.id}`);
        trace.resolvedSource = "userTenants_query";
        trace.resolvedRole = parsed.ok.role;
        console.log("[resolveRespondUser]", { ...trace, found: "scan_uid", docId: d.id });
        return { user: attachSource(parsed.ok, "userTenants_query"), trace };
      }
    }
    push(`scan_uid_field:no_valid(${byUidField.size} docs)`);
  } catch (e) {
    push(`scan_uid_field:error:${(e as Error).message}`);
  }

  // 4) users/{uid} (portal staff / clients often have tenantId + role here)
  const userSnap = await db.collection("users").doc(uid).get();
  trace.usersDocExists = userSnap.exists;
  if (userSnap.exists) {
    const u = userSnap.data() as { tenantId?: string; role?: string; clientId?: string };
    trace.usersDocTenantId = u.tenantId ?? null;
    trace.usersDocRole = u.role ?? null;
    if (u.tenantId === tenantId) {
      const roleLower = String(u.role ?? "").toLowerCase();
      if (["owner", "admin", "client"].includes(roleLower)) {
        const cid = u.clientId != null ? String(u.clientId).trim() : "";
        push("users_doc:accepted");
        trace.resolvedSource = "users_doc";
        trace.resolvedRole = roleLower;
        const user = attachSource({ role: roleLower, clientId: cid || null }, "users_doc");
        console.log("[resolveRespondUser]", { ...trace, found: "users_doc" });
        return { user, trace };
      }
      push(`users_doc:role_not_allowed:${roleLower || "empty"}`);
    } else {
      push(`users_doc:tenant_mismatch users.tenantId=${u.tenantId ?? "null"}`);
    }
  } else {
    push("users_doc:missing");
  }

  console.log("[resolveRespondUser] FAILED", trace);
  return { user: null, trace };
}
