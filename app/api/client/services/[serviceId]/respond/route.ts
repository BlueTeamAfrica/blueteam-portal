import "server-only";
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireBearerUid } from "@/lib/server/resolvePortalUser";
import { submitClientServiceResponse } from "@/lib/server/serviceClientInput";

const FORBIDDEN_RESPOND = "You do not have permission to respond to this request.";

type ResolvedRespondUser = {
  role: string;
  clientId: string | null;
};

function isActiveMembershipStatus(status: unknown): boolean {
  if (status == null || status === "") return true;
  return String(status).toLowerCase() === "active";
}

/**
 * Resolves caller for this tenant: owner | admin | client (lowercased roles).
 * Uses userTenants map, legacy userTenants query, then users/{uid} — with
 * case-insensitive active status so admin/owner are not dropped vs invoice-only checks.
 */
async function resolveRespondUser(uid: string, tenantId: string): Promise<ResolvedRespondUser | null> {
  const db = adminDb();
  const memId = `${uid}_${tenantId}`;
  const memSnap = await db.collection("userTenants").doc(memId).get();
  if (memSnap.exists) {
    const mem = memSnap.data() as { role?: string; status?: string; clientId?: string };
    if (!isActiveMembershipStatus(mem.status)) return null;
    const roleLower = String(mem.role ?? "").toLowerCase();
    if (!["owner", "admin", "client"].includes(roleLower)) return null;
    const cid = mem.clientId != null ? String(mem.clientId).trim() : "";
    return { role: roleLower, clientId: cid || null };
  }

  const legacySnap = await db
    .collection("userTenants")
    .where("userId", "==", uid)
    .where("tenantId", "==", tenantId)
    .limit(1)
    .get();
  if (!legacySnap.empty) {
    const mem = legacySnap.docs[0].data() as { role?: string; status?: string; clientId?: string };
    if (!isActiveMembershipStatus(mem.status)) return null;
    const roleLower = String(mem.role ?? "").toLowerCase();
    if (!["owner", "admin", "client"].includes(roleLower)) return null;
    const cid = mem.clientId != null ? String(mem.clientId).trim() : "";
    return { role: roleLower, clientId: cid || null };
  }

  const userSnap = await db.collection("users").doc(uid).get();
  if (!userSnap.exists) return null;
  const u = userSnap.data() as { tenantId?: string; role?: string; clientId?: string };
  if (u.tenantId !== tenantId) return null;
  const roleLower = String(u.role ?? "").toLowerCase();
  if (!["owner", "admin", "client"].includes(roleLower)) return null;
  const cid = u.clientId != null ? String(u.clientId).trim() : "";
  return { role: roleLower, clientId: cid || null };
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ serviceId: string }> }
) {
  try {
    const uid = await requireBearerUid(req);
    const { serviceId } = await params;
    const sid = typeof serviceId === "string" ? serviceId.trim() : "";
    if (!sid) {
      return NextResponse.json({ error: "serviceId required" }, { status: 400 });
    }

    const body = (await req.json()) as { tenantId?: string; message?: string };
    const tenantId = typeof body.tenantId === "string" ? body.tenantId.trim() : "";
    if (!tenantId) {
      return NextResponse.json({ error: "tenantId required" }, { status: 400 });
    }

    const db = adminDb();
    const svcSnap = await db.collection("tenants").doc(tenantId).collection("services").doc(sid).get();
    if (!svcSnap.exists) {
      return NextResponse.json({ error: "Service not found" }, { status: 404 });
    }
    const svcRaw = svcSnap.data() as Record<string, unknown>;
    const serviceClientId = String(svcRaw.clientId ?? "").trim();
    /** Tenant that owns this service document (request path is source of truth). */
    const serviceTenantId = tenantId;
    const docTenantRaw = typeof svcRaw.tenantId === "string" ? svcRaw.tenantId.trim() : "";
    if (docTenantRaw && docTenantRaw !== serviceTenantId) {
      const debug = {
        uid,
        role: null as string | null,
        userClientId: null as string | null,
        serviceClientId,
        tenantId,
        serviceTenantId,
        reason: "service_document_tenant_mismatch" as const,
      };
      console.log("[respond] forbidden", debug);
      return NextResponse.json({ error: FORBIDDEN_RESPOND, debug }, { status: 403 });
    }

    const resolved = await resolveRespondUser(uid, tenantId);
    const role = resolved?.role ?? null;
    const userClientId = resolved?.clientId ?? null;

    console.log({
      uid,
      role,
      userClientId,
      serviceClientId,
      tenantId,
      serviceTenantId,
    });

    const debugBase = {
      uid,
      role,
      userClientId,
      serviceClientId,
      tenantId,
      serviceTenantId,
    };

    if (!resolved) {
      const debug = { ...debugBase, reason: "not_member_of_tenant" as const };
      console.log("[respond] forbidden", debug);
      return NextResponse.json({ error: FORBIDDEN_RESPOND, debug }, { status: 403 });
    }

    let effectiveClientId: string;

    if (resolved.role === "client") {
      const ucid = userClientId?.trim() ?? "";
      if (!ucid || ucid !== serviceClientId) {
        const debug = { ...debugBase, reason: "client_clientid_mismatch" as const };
        console.log("[respond] forbidden", debug);
        return NextResponse.json({ error: FORBIDDEN_RESPOND, debug }, { status: 403 });
      }
      effectiveClientId = ucid;
    } else if (resolved.role === "owner" || resolved.role === "admin") {
      if (!serviceClientId) {
        return NextResponse.json({ error: "Service has no linked client." }, { status: 400 });
      }
      effectiveClientId = serviceClientId;
    } else {
      const debug = { ...debugBase, reason: "forbidden_role" as const };
      console.log("[respond] forbidden", debug);
      return NextResponse.json({ error: FORBIDDEN_RESPOND, debug }, { status: 403 });
    }

    await submitClientServiceResponse({
      tenantId,
      serviceId: sid,
      clientUserId: uid,
      clientId: effectiveClientId,
      message: typeof body.message === "string" ? body.message : "",
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    const err = e as { message?: string; status?: number };
    const status = typeof err.status === "number" ? err.status : 500;
    return NextResponse.json({ error: err.message ?? "Server error" }, { status });
  }
}
