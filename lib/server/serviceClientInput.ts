import "server-only";
import type { DocumentReference, Firestore } from "firebase-admin/firestore";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebaseAdmin";
import { SERVICE_WAITING_CLIENT_SENT_AT } from "@/lib/server/clientNotificationDedupe";
import {
  getClientServicePortalUrl,
  sendClientServiceWaitingEmail,
} from "@/lib/mailer";
import { notificationDocIdFromDedupeKey, upsertNotification } from "@/lib/server/notifications";
import { getClientUsers, getTenantAdmins } from "@/lib/server/tenantUsers";
import { getManagedServiceDisplayName } from "@/lib/serviceDisplayName";
import { normalizeServiceHealth } from "@/lib/serviceHealth";

type ClaimOutcome = "claimed" | "already_notified" | "not_eligible";

async function tryClaimServiceWaitingDedupe(
  db: Firestore,
  ref: DocumentReference,
  isEligible: (raw: Record<string, unknown>) => boolean
): Promise<ClaimOutcome> {
  try {
    return await db.runTransaction(async (t) => {
      const snap = await t.get(ref);
      if (!snap.exists) return "not_eligible";
      const raw = snap.data() as Record<string, unknown>;
      if (raw[SERVICE_WAITING_CLIENT_SENT_AT] != null) return "already_notified";
      if (!isEligible(raw)) return "not_eligible";
      t.update(ref, { [SERVICE_WAITING_CLIENT_SENT_AT]: FieldValue.serverTimestamp() });
      return "claimed";
    });
  } catch (e) {
    console.error("[service-client-input] dedupe claim failed", {
      path: ref.path,
      err: e instanceof Error ? e.message : e,
    });
    return "not_eligible";
  }
}

async function archiveServiceInputNotificationsForUsers(
  tenantId: string,
  serviceId: string,
  userIds: string[]
): Promise<void> {
  const db = adminDb();
  const now = Timestamp.now();
  for (const uid of userIds) {
    const docId = notificationDocIdFromDedupeKey(`service_input_needed:${serviceId}:${uid}`);
    const nref = db.collection("tenants").doc(tenantId).collection("notifications").doc(docId);
    const snap = await nref.get();
    if (!snap.exists) continue;
    const d = snap.data() as { status?: string };
    if (d.status === "archived") continue;
    await nref
      .update({
        status: "archived",
        updatedAt: now,
      })
      .catch((err) => {
        console.warn("[service-client-input] archive notification failed", { docId, err });
      });
  }
}

/**
 * Mark service as needing client input: structured fields + health waiting_client,
 * upsert rolling in-app notifications, optional first email (shared dedupe with cron).
 */
export async function requestServiceClientInput(params: {
  tenantId: string;
  serviceId: string;
  message: string;
}): Promise<{ emailSent: boolean }> {
  const { tenantId, serviceId, message } = params;
  const trimmed = message.trim();
  if (!trimmed) {
    throw Object.assign(new Error("Message is required"), { status: 400 });
  }

  const db = adminDb();
  const ref = db.collection("tenants").doc(tenantId).collection("services").doc(serviceId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw Object.assign(new Error("Service not found"), { status: 404 });
  }
  const before = snap.data() as Record<string, unknown>;
  const clientId = before.clientId as string | undefined;
  if (!clientId?.trim()) {
    throw Object.assign(new Error("Service has no clientId"), { status: 400 });
  }

  const now = Timestamp.now();
  const nextActionShort = trimmed.length > 220 ? `${trimmed.slice(0, 220)}…` : trimmed;

  await ref.update({
    clientActionRequired: true,
    clientActionStatus: "pending",
    clientActionMessage: trimmed,
    clientActionRequestedAt: now,
    clientActionResolvedAt: FieldValue.delete(),
    clientActionResponse: FieldValue.delete(),
    clientActionRespondedAt: FieldValue.delete(),
    clientActionRespondedByUid: FieldValue.delete(),
    health: "waiting_client",
    healthNote: trimmed,
    nextAction: nextActionShort,
    lastCheckedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  const freshSnap = await ref.get();
  const data = (freshSnap.data() ?? {}) as Record<string, unknown>;

  const tenantSnap = await db.collection("tenants").doc(tenantId).get();
  const tenantName = tenantSnap.exists
    ? String((tenantSnap.data() as { name?: string })?.name || tenantId)
    : tenantId;

  const clientSnap = await db.collection("tenants").doc(tenantId).collection("clients").doc(clientId).get();
  if (!clientSnap.exists) {
    throw Object.assign(new Error("Client not found"), { status: 404 });
  }
  const client = clientSnap.data() as { email?: string; name?: string };
  const clientName = String(before.clientName ?? client.name ?? clientId);
  const to = client.email?.trim();

  const serviceName = getManagedServiceDisplayName({
    name: data.name as string | undefined,
    category: data.category as string | undefined,
    categoryLabel: data.categoryLabel as string | undefined,
  });
  const serviceUrl = getClientServicePortalUrl(serviceId);

  let emailSent = false;
  const claim = await tryClaimServiceWaitingDedupe(db, ref, (raw) => {
    return normalizeServiceHealth(raw.health as string | undefined) === "waiting_client";
  });

  if (claim === "claimed") {
    if (to) {
      try {
        await sendClientServiceWaitingEmail({
          to,
          clientName,
          tenantName,
          serviceName,
          healthNote: trimmed,
          nextAction: nextActionShort,
          serviceUrl,
        });
        emailSent = true;
      } catch (e) {
        console.error("[service-client-input] email send failed", { serviceId, err: e });
        await ref.update({ [SERVICE_WAITING_CLIENT_SENT_AT]: FieldValue.delete() }).catch(() => {});
      }
    } else {
      await ref.update({ [SERVICE_WAITING_CLIENT_SENT_AT]: FieldValue.delete() }).catch(() => {});
    }
  }

  const portalUsers = await getClientUsers(clientId, tenantId);
  const title = `Input needed: ${serviceName}`;
  const body =
    trimmed.length > 400 ? `${trimmed.slice(0, 397)}…` : trimmed || "Your team needs information to continue this service.";

  for (const u of portalUsers) {
    try {
      await upsertNotification({
        tenantId,
        type: "service_input_needed",
        title,
        body,
        targetType: "user",
        targetUserId: u.uid,
        clientId,
        entityType: "service",
        entityId: serviceId,
        actionUrl: `/client/services/${serviceId}`,
        dedupeKey: `service_input_needed:${serviceId}:${u.uid}`,
        forceUnreadOnUpdate: true,
      });
    } catch (e) {
      console.error("[service-client-input] notification upsert failed", { serviceId, uid: u.uid, err: e });
    }
  }

  return { emailSent };
}

/** Resolve client input request: clear waiting state, dedupe, archive per-user notifications. */
export async function resolveServiceClientInput(params: { tenantId: string; serviceId: string }): Promise<void> {
  const { tenantId, serviceId } = params;
  const db = adminDb();
  const ref = db.collection("tenants").doc(tenantId).collection("services").doc(serviceId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw Object.assign(new Error("Service not found"), { status: 404 });
  }
  const before = snap.data() as Record<string, unknown>;
  const clientId = before.clientId as string | undefined;
  if (!clientId?.trim()) {
    throw Object.assign(new Error("Service has no clientId"), { status: 400 });
  }

  await ref.update({
    clientActionRequired: false,
    clientActionStatus: "resolved",
    clientActionResolvedAt: FieldValue.serverTimestamp(),
    health: "healthy",
    [SERVICE_WAITING_CLIENT_SENT_AT]: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  const portalUsers = await getClientUsers(clientId, tenantId);
  await archiveServiceInputNotificationsForUsers(
    tenantId,
    serviceId,
    portalUsers.map((u) => u.uid)
  );
}

/**
 * Client submits a response to an active input request: stores reply, clears pending state,
 * archives client `service_input_needed` notifications, notifies tenant admins/owners in-app.
 */
export async function submitClientServiceResponse(params: {
  tenantId: string;
  serviceId: string;
  clientUserId: string;
  clientId: string;
  message: string;
}): Promise<void> {
  const { tenantId, serviceId, clientUserId, clientId, message } = params;
  const trimmed = message.trim();
  if (!trimmed) {
    throw Object.assign(new Error("Message is required"), { status: 400 });
  }

  const db = adminDb();
  const ref = db.collection("tenants").doc(tenantId).collection("services").doc(serviceId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw Object.assign(new Error("Service not found"), { status: 404 });
  }
  const data = snap.data() as Record<string, unknown>;
  const svcClientId = data.clientId as string | undefined;
  if (!svcClientId?.trim() || svcClientId !== clientId) {
    throw Object.assign(new Error("Not authorized for this service"), { status: 403 });
  }

  const pending =
    data.clientActionRequired === true && String(data.clientActionStatus ?? "").toLowerCase() === "pending";
  if (!pending) {
    throw Object.assign(new Error("No active client input request for this service"), { status: 400 });
  }

  const now = Timestamp.now();
  const bodyShort = trimmed.length > 500 ? `${trimmed.slice(0, 497)}…` : trimmed;

  await ref.update({
    clientActionRequired: false,
    clientActionStatus: "responded",
    clientActionResponse: trimmed,
    clientActionRespondedAt: now,
    clientActionRespondedByUid: clientUserId,
    health: "healthy",
    [SERVICE_WAITING_CLIENT_SENT_AT]: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  const portalUsers = await getClientUsers(clientId, tenantId);
  await archiveServiceInputNotificationsForUsers(
    tenantId,
    serviceId,
    portalUsers.map((u) => u.uid)
  );

  const serviceName = getManagedServiceDisplayName({
    name: data.name as string | undefined,
    category: data.category as string | undefined,
    categoryLabel: data.categoryLabel as string | undefined,
  });

  const admins = await getTenantAdmins(tenantId);
  const title = `Client responded: ${serviceName}`;
  const body = bodyShort || "The client submitted a response.";

  for (const a of admins) {
    try {
      await upsertNotification({
        tenantId,
        type: "service_client_responded",
        title,
        body,
        targetType: "user",
        targetUserId: a.uid,
        clientId,
        entityType: "service",
        entityId: serviceId,
        actionUrl: `/portal/services/${serviceId}`,
        dedupeKey: `service_client_responded:${serviceId}:${a.uid}`,
        forceUnreadOnUpdate: true,
      });
    } catch (e) {
      console.error("[service-client-input] admin notify failed", { serviceId, adminUid: a.uid, err: e });
    }
  }
}
