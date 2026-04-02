import "server-only";
import { NextResponse } from "next/server";
import type { DocumentSnapshot } from "firebase-admin/firestore";
import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebaseAdmin";
import {
  canAccessNotificationData,
  requireBearerUid,
  resolvePortalUserForTenant,
} from "@/lib/server/resolvePortalUser";

const BATCH = 400;

export async function POST(req: Request) {
  try {
    const uid = await requireBearerUid(req);
    const body = (await req.json()) as { tenantId?: string };
    const tenantId = typeof body.tenantId === "string" ? body.tenantId.trim() : "";
    if (!tenantId) {
      return NextResponse.json({ error: "tenantId required" }, { status: 400 });
    }

    const ctx = await resolvePortalUserForTenant(uid, tenantId);
    if (!ctx) {
      return NextResponse.json({ error: "Not authorized for tenant" }, { status: 403 });
    }

    const db = adminDb();
    const col = db.collection("tenants").doc(tenantId).collection("notifications");
    const now = Timestamp.now();

    const userUnread = await col
      .where("targetType", "==", "user")
      .where("targetUserId", "==", uid)
      .where("status", "==", "unread")
      .limit(BATCH)
      .get();

    let roleUnread =
      ctx.roleLower === "client" && ctx.clientId
        ? await col
            .where("targetType", "==", "role")
            .where("targetRole", "==", "client")
            .where("clientId", "==", ctx.clientId)
            .where("status", "==", "unread")
            .limit(BATCH)
            .get()
        : await col
            .where("targetType", "==", "role")
            .where("targetRole", "==", ctx.roleLower)
            .where("status", "==", "unread")
            .limit(BATCH)
            .get();

    const toMark = new Map<string, DocumentSnapshot>();
    for (const d of userUnread.docs) {
      toMark.set(d.id, d);
    }
    for (const d of roleUnread.docs) {
      const data = d.data();
      if (!canAccessNotificationData(ctx, data)) continue;
      toMark.set(d.id, d);
    }

    const entries = [...toMark.values()].slice(0, BATCH);
    const batch = db.batch();
    for (const d of entries) {
      batch.update(d.ref, { status: "read", readAt: now, updatedAt: now });
    }
    if (entries.length > 0) {
      await batch.commit();
    }

    return NextResponse.json({ ok: true, updated: entries.length });
  } catch (e) {
    const status = typeof (e as { status?: number }).status === "number" ? (e as { status: number }).status : 500;
    if (status === 401) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[api/notifications/mark-all-read]", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
