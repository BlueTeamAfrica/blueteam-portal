import "server-only";
import { NextResponse } from "next/server";
import { requireBearerUid } from "@/lib/server/resolvePortalUser";
import { requestServiceClientInput } from "@/lib/server/serviceClientInput";
import { assertStaffCanManageServices } from "@/lib/server/tenantInvoiceAccess";

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

    await assertStaffCanManageServices(uid, tenantId);

    const message = typeof body.message === "string" ? body.message : "";
    const result = await requestServiceClientInput({ tenantId, serviceId: sid, message });

    return NextResponse.json({ ok: true, emailSent: result.emailSent });
  } catch (e) {
    const err = e as { message?: string; status?: number };
    const status = typeof err.status === "number" ? err.status : 500;
    return NextResponse.json({ error: err.message ?? "Server error" }, { status });
  }
}
