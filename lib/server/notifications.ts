import "server-only";
import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebaseAdmin";

export type PortalNotificationType =
  | "invoice_overdue"
  | "service_input_needed"
  | "support_waiting_client"
  | "support_waiting_admin";

export type NotificationInput = {
  tenantId: string;
  type: PortalNotificationType;
  title: string;
  body: string;
  targetType: "user" | "role";
  targetUserId?: string;
  targetRole?: "owner" | "admin" | "client";
  clientId?: string;
  entityType?: "invoice" | "service" | "ticket";
  entityId?: string;
  actionUrl?: string;
  dedupeKey: string;
};

/** Firestore document id: safe segment (no `/`). */
export function notificationDocIdFromDedupeKey(dedupeKey: string): string {
  return dedupeKey.replace(/\//g, "_");
}

/**
 * Idempotent upsert: doc id = sanitized dedupeKey. Server-only.
 * Existing doc: refresh title/body/actionUrl + updatedAt (same spell, updated copy).
 */
export async function upsertNotification(input: NotificationInput): Promise<string> {
  const db = adminDb();
  const docId = notificationDocIdFromDedupeKey(input.dedupeKey);
  const ref = db.collection("tenants").doc(input.tenantId).collection("notifications").doc(docId);

  const now = Timestamp.now();
  const snap = await ref.get();

  if (snap.exists) {
    await ref.update({
      title: input.title,
      body: input.body,
      actionUrl: input.actionUrl ?? null,
      updatedAt: now,
    });
    return docId;
  }

  await ref.set({
    type: input.type,
    title: input.title,
    body: input.body,
    tenantId: input.tenantId,
    targetType: input.targetType,
    targetUserId: input.targetUserId ?? null,
    targetRole: input.targetRole ?? null,
    clientId: input.clientId ?? null,
    entityType: input.entityType ?? null,
    entityId: input.entityId ?? null,
    actionUrl: input.actionUrl ?? null,
    dedupeKey: input.dedupeKey,
    status: "unread",
    emailSent: false,
    emailSentAt: null,
    createdAt: now,
    updatedAt: now,
    readAt: null,
  });

  return docId;
}
