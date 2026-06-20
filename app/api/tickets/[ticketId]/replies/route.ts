import "server-only";
import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireBearerUid, resolvePortalUserForTenant } from "@/lib/server/resolvePortalUser";
import { upsertNotification } from "@/lib/server/notifications";
import { getTenantAdmins, getClientUsers } from "@/lib/server/tenantUsers";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ ticketId: string }> }
) {
  try {
    const uid = await requireBearerUid(req);
    const { ticketId } = await params;
    if (!ticketId?.trim()) {
      return NextResponse.json({ error: "ticketId required" }, { status: 400 });
    }

    const body = (await req.json()) as { tenantId?: string; message?: string };
    const tenantId = typeof body.tenantId === "string" ? body.tenantId.trim() : "";
    if (!tenantId) {
      return NextResponse.json({ error: "tenantId required" }, { status: 400 });
    }
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message) {
      return NextResponse.json({ error: "message required" }, { status: 400 });
    }

    const member = await resolvePortalUserForTenant(uid, tenantId);
    if (!member) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }
    const { roleLower, clientId } = member;
    const isStaff = roleLower === "admin" || roleLower === "owner";

    const db = adminDb();
    const ticketRef = db.collection("tenants").doc(tenantId).collection("tickets").doc(ticketId);
    const ticketSnap = await ticketRef.get();
    if (!ticketSnap.exists) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }
    const ticket = ticketSnap.data() as {
      clientId?: string;
      status?: string;
      subject?: string;
    };

    if (!isStaff) {
      if (!clientId || ticket.clientId !== clientId) {
        return NextResponse.json({ error: "Not authorized" }, { status: 403 });
      }
    }

    const authorRole = isStaff ? "admin" : "client";
    const replyRef = await ticketRef.collection("replies").add({
      message,
      authorRole,
      authorUid: uid,
      createdAt: FieldValue.serverTimestamp(),
    });

    const ticketPatch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
    if (isStaff && (ticket.status ?? "open") === "open") {
      ticketPatch.status = "in_progress";
    }
    await ticketRef.update(ticketPatch);

    const ticketSubject = ticket.subject ?? "Support ticket";
    const replyId = replyRef.id;
    const ticketClientId = ticket.clientId ?? "";
    const bodyShort = message.length > 200 ? `${message.slice(0, 197)}…` : message;

    if (!isStaff) {
      const admins = await getTenantAdmins(tenantId);
      for (const admin of admins) {
        try {
          await upsertNotification({
            tenantId,
            type: "support_waiting_admin",
            title: `Client replied: ${ticketSubject}`,
            body: bodyShort,
            targetType: "user",
            targetUserId: admin.uid,
            clientId: ticketClientId || undefined,
            entityType: "ticket",
            entityId: ticketId,
            actionUrl: `/portal/support/${ticketId}`,
            dedupeKey: `ticket_reply:${ticketId}:${replyId}:${admin.uid}`,
          });
        } catch (e) {
          console.error("[api/tickets/replies] admin notify failed", { ticketId, adminUid: admin.uid, err: e });
        }
      }
    } else {
      if (ticketClientId) {
        const clientUsers = await getClientUsers(ticketClientId, tenantId);
        for (const cu of clientUsers) {
          try {
            await upsertNotification({
              tenantId,
              type: "support_waiting_client",
              title: `New reply: ${ticketSubject}`,
              body: bodyShort,
              targetType: "user",
              targetUserId: cu.uid,
              clientId: ticketClientId,
              entityType: "ticket",
              entityId: ticketId,
              actionUrl: `/client/support/${ticketId}`,
              dedupeKey: `ticket_reply:${ticketId}:${replyId}:${cu.uid}`,
            });
          } catch (e) {
            console.error("[api/tickets/replies] client notify failed", { ticketId, clientUid: cu.uid, err: e });
          }
        }
      }
    }

    return NextResponse.json({ ok: true, replyId });
  } catch (e) {
    const status = typeof (e as { status?: number }).status === "number" ? (e as { status: number }).status : 500;
    if (status === 401) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (status === 403) return NextResponse.json({ error: (e as Error).message || "Forbidden" }, { status: 403 });
    console.error("[api/tickets/replies POST]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Server error" }, { status: 500 });
  }
}
