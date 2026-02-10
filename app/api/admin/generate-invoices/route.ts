import "server-only";
import { NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { generateDueInvoicesForTenant } from "@/lib/server/generateDueInvoices";

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const match = authHeader.match(/^Bearer (.+)$/);
    if (!match) {
      return NextResponse.json({ error: "Missing Authorization Bearer token" }, { status: 401 });
    }

    const token = match[1];
    const decoded = await adminAuth().verifyIdToken(token);
    const uid = decoded.uid;

    const db = adminDb();

    let tenantId: string | undefined;
    try {
      const body = await req.json().catch(() => ({})) as { tenantId?: string };
      tenantId = body.tenantId;
    } catch {
      // no body
    }
    if (!tenantId) {
      const userSnap = await db.collection("users").doc(uid).get();
      if (userSnap.exists) {
        tenantId = (userSnap.data() as { tenantId?: string })?.tenantId;
      }
    }
    if (!tenantId) {
      const utSnap = await db.collection("userTenants").where("userId", "==", uid).limit(1).get();
      if (!utSnap.empty) {
        tenantId = utSnap.docs[0].data().tenantId as string;
      }
    }
    if (!tenantId) {
      return NextResponse.json({ error: "User missing tenantId" }, { status: 403 });
    }

    const membershipId = `${uid}_${tenantId}`;
    const memSnap = await db.collection("userTenants").doc(membershipId).get();
    if (!memSnap.exists) {
      return NextResponse.json({ error: "Tenant membership not found" }, { status: 403 });
    }
    const mem = memSnap.data() as { role?: string; status?: string };
    if (mem.status !== "active" || (mem.role !== "owner" && mem.role !== "admin")) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    const result = await generateDueInvoicesForTenant(tenantId);
    return NextResponse.json({
      tenantId,
      ...result,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 }
    );
  }
}
