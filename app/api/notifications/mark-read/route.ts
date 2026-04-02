import "server-only";
import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebaseAdmin";
import {
  canAccessNotificationData,
  requireBearerUid,
  resolvePortalUserForTenant,
} from "@/lib/server/resolvePortalUser";

export async function POST(req: Request) {
  try {
    const uid = await requireBearerUid(req);
    const body = (await req.json()) as { tenantId?: string; notificationId?: string };
    const tenantId = typeof body.tenantId === "string" ? body.tenantId.trim() : "";
    const notificationId = typeof body.notificationId === "string" ? body.notificationId.trim() : "";
    if (!tenantId || !notificationId) {
      return NextResponse.json({ error: "tenantId and notificationId required" }, { status: 400 });
    }

    const ctx = await resolvePortalUserForTenant(uid, tenantId);
    if (!ctx) {
      return NextResponse.json({ error: "Not authorized for tenant" }, { status: 403 });
    }

    const db = adminDb();
    const ref = db.collection("tenants").doc(tenantId).collection("notifications").doc(notificationId);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const data = snap.data()!;
    if (data.tenantId !== tenantId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!canAccessNotificationData(ctx, data)) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    const now = Timestamp.now();
    await ref.update({
      status: "read",
      readAt: now,
      updatedAt: now,
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    const status = typeof (e as { status?: number }).status === "number" ? (e as { status: number }).status : 500;
    if (status === 401) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[api/notifications/mark-read]", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
