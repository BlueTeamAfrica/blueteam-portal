import "server-only";
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireBearerUid, resolvePortalUserForTenant } from "@/lib/server/resolvePortalUser";
import { submitClientServiceResponse } from "@/lib/server/serviceClientInput";
import { isTenantStaffMember } from "@/lib/server/tenantInvoiceAccess";

const FORBIDDEN_RESPOND = "You do not have permission to respond to this request.";

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
    const svcClientId = String(svcRaw.clientId ?? "").trim();

    /**
     * Staff: same gate as invoice/service admin APIs (userTenants + legacy + users/{uid} fallback).
     * This avoids 403 when resolvePortalUserForTenant misses owner/admin (e.g. missing userTenants map doc).
     */
    const staff = await isTenantStaffMember(uid, tenantId);
    let effectiveClientId: string;

    if (staff) {
      if (!svcClientId) {
        return NextResponse.json({ error: "Service has no linked client." }, { status: 400 });
      }
      effectiveClientId = svcClientId;
    } else {
      const ctx = await resolvePortalUserForTenant(uid, tenantId);
      if (!ctx || ctx.roleLower !== "client") {
        return NextResponse.json({ error: FORBIDDEN_RESPOND }, { status: 403 });
      }
      const uidClient = ctx.clientId?.trim() ?? "";
      if (!uidClient || uidClient !== svcClientId) {
        return NextResponse.json({ error: FORBIDDEN_RESPOND }, { status: 403 });
      }
      effectiveClientId = uidClient;
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
