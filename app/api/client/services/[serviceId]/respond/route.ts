import "server-only";
import { NextResponse } from "next/server";
import { requireBearerUid, resolvePortalUserForTenant } from "@/lib/server/resolvePortalUser";
import { submitClientServiceResponse } from "@/lib/server/serviceClientInput";

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

    const ctx = await resolvePortalUserForTenant(uid, tenantId);
    if (!ctx) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }
    if (ctx.roleLower !== "client" || !ctx.clientId?.trim()) {
      return NextResponse.json({ error: "Client access only" }, { status: 403 });
    }

    await submitClientServiceResponse({
      tenantId,
      serviceId: sid,
      clientUserId: uid,
      clientId: ctx.clientId,
      message: typeof body.message === "string" ? body.message : "",
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    const err = e as { message?: string; status?: number };
    const status = typeof err.status === "number" ? err.status : 500;
    return NextResponse.json({ error: err.message ?? "Server error" }, { status });
  }
}
