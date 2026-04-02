import "server-only";
import type { DocumentReference, Firestore } from "firebase-admin/firestore";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebaseAdmin";
import {
  INVOICE_OVERDUE_SENT_AT,
  OVERDUE_EMAIL_SENT_AT,
  OVERDUE_NOTIFIED_AT,
  SERVICE_WAITING_CLIENT_SENT_AT,
  TICKET_REPLY_WAITING_SENT_AT,
} from "@/lib/server/clientNotificationDedupe";
import {
  emptyChannelMetrics,
  mergeSkip,
  type NotificationChannelMetrics,
  type NotificationSkipMetrics,
} from "@/lib/server/clientNotificationMetrics";
import { generateOverdueInvoiceNotifications, isOpenInvoiceAwaitingPayment } from "@/lib/server/generateOverdueInvoiceNotifications";
import {
  getClientServicePortalUrl,
  getClientSupportTicketPortalUrl,
  sendClientServiceWaitingEmail,
  sendClientSupportReplyWaitingEmail,
} from "@/lib/mailer";
import { isUnpaidOrOverdueInvoice } from "@/lib/clientPortalSignals";
import { normalizeServiceHealth } from "@/lib/serviceHealth";
import { getManagedServiceDisplayName } from "@/lib/serviceDisplayName";

export {
  INVOICE_OVERDUE_SENT_AT,
  SERVICE_WAITING_CLIENT_SENT_AT,
  TICKET_REPLY_WAITING_SENT_AT,
} from "@/lib/server/clientNotificationDedupe";

/**
 * Client notification deduplication (one email per “spell”, no spam on cron overlap):
 *
 * 1. Each actionable document stores a server timestamp in a dedicated field when an email is successfully queued
 *    (actually: we set the field inside a transaction *before* send; if send fails we delete the field so the next
 *    cron can retry).
 * 2. Cleanup pass: if the underlying state is no longer actionable (invoice paid / no longer past due; service health
 *    moved off waiting_client; ticket no longer waiting_client), the dedupe field is removed so a future spell can notify
 *    again.
 * 3. Concurrent crons: only one transaction can claim an empty dedupe slot for a still-eligible doc; others see
 *    already_notified / not_eligible and skip (skip.claimNotTaken / alreadyNotified).
 */
export type { NotificationChannelMetrics, NotificationSkipMetrics } from "@/lib/server/clientNotificationMetrics";

type ClaimOutcome = "claimed" | "already_notified" | "not_eligible";

/** Atomically set dedupe timestamp only if absent and still eligible (prevents double-send under overlapping cron). */
async function tryClaimNotificationDedupe(
  db: Firestore,
  ref: DocumentReference,
  dedupeField: string,
  isEligible: (raw: Record<string, unknown>) => boolean
): Promise<ClaimOutcome> {
  try {
    return await db.runTransaction(async (t) => {
      const snap = await t.get(ref);
      if (!snap.exists) return "not_eligible";
      const raw = snap.data() as Record<string, unknown>;
      if (raw[dedupeField] != null) return "already_notified";
      if (!isEligible(raw)) return "not_eligible";
      t.update(ref, { [dedupeField]: FieldValue.serverTimestamp() });
      return "claimed";
    });
  } catch (e) {
    console.error("[client-notifications] dedupe claim transaction failed", {
      path: ref.path,
      dedupeField,
      err: e instanceof Error ? e.message : e,
    });
    return "not_eligible";
  }
}

function toDateMaybe(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Timestamp) return v.toDate();
  if (typeof (v as { toDate?: () => Date }).toDate === "function") {
    try {
      return (v as { toDate: () => Date }).toDate();
    } catch {
      return null;
    }
  }
  if (v instanceof Date) return v;
  if (typeof v === "string" || typeof v === "number") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export type ClientNotificationsTenantResult = {
  tenantId: string;
  overdueInvoice: NotificationChannelMetrics;
  serviceWaiting: NotificationChannelMetrics;
  supportWaiting: NotificationChannelMetrics;
};

export type ProcessClientNotificationsResult = {
  ranAt: string;
  tenantCount: number;
  totals: {
    overdueInvoice: NotificationChannelMetrics;
    serviceWaiting: NotificationChannelMetrics;
    supportWaiting: NotificationChannelMetrics;
  };
  results: ClientNotificationsTenantResult[];
  errors: Array<{ tenantId: string; message: string }>;
};

export async function processClientNotificationsForTenant(tenantId: string): Promise<ClientNotificationsTenantResult> {
  const db = adminDb();
  const now = new Date();

  const tenantSnap = await db.collection("tenants").doc(tenantId).get();
  const tenantName = tenantSnap.exists
    ? ((tenantSnap.data() as { name?: string })?.name || tenantId)
    : tenantId;

  const overdueInvoice = emptyChannelMetrics();
  const serviceWaiting = emptyChannelMetrics();
  const supportWaiting = emptyChannelMetrics();

  const invoicesRef = db.collection("tenants").doc(tenantId).collection("invoices");
  const servicesRef = db.collection("tenants").doc(tenantId).collection("services");
  const ticketsRef = db.collection("tenants").doc(tenantId).collection("tickets");

  // --- Cleanup stale dedupe flags (state left actionable) ---
  const epoch = Timestamp.fromMillis(0);

  const overdueDedupeSnaps = await Promise.all([
    invoicesRef.where(INVOICE_OVERDUE_SENT_AT, ">", epoch).get(),
    invoicesRef.where(OVERDUE_EMAIL_SENT_AT, ">", epoch).get(),
    invoicesRef.where(OVERDUE_NOTIFIED_AT, ">", epoch).get(),
  ]);
  const clearedInvoiceIds = new Set<string>();
  for (const snap of overdueDedupeSnaps) {
    for (const doc of snap.docs) {
      if (clearedInvoiceIds.has(doc.id)) continue;
      const data = doc.data() as {
        status?: string;
        dueDate?: unknown;
        [key: string]: unknown;
      };
      const due = toDateMaybe(data.dueDate);
      const pastDue = due !== null && due.getTime() < now.getTime();
      const open = isOpenInvoiceAwaitingPayment(data.status);
      if (!pastDue || !open) {
        clearedInvoiceIds.add(doc.id);
        await doc.ref.update({
          [INVOICE_OVERDUE_SENT_AT]: FieldValue.delete(),
          [OVERDUE_EMAIL_SENT_AT]: FieldValue.delete(),
          [OVERDUE_NOTIFIED_AT]: FieldValue.delete(),
        });
        overdueInvoice.cleared += 1;
        console.log("[client-notifications] cleared invoice overdue flags", { tenantId, invoiceId: doc.id });
      }
    }
  }

  const svcSentSnap = await servicesRef.where(SERVICE_WAITING_CLIENT_SENT_AT, ">", epoch).get();
  for (const doc of svcSentSnap.docs) {
    const data = doc.data() as { health?: string };
    if (normalizeServiceHealth(data.health) !== "waiting_client") {
      await doc.ref.update({ [SERVICE_WAITING_CLIENT_SENT_AT]: FieldValue.delete() });
      serviceWaiting.cleared += 1;
      console.log("[client-notifications] cleared service waiting flag", { tenantId, serviceId: doc.id });
    }
  }

  const ticketSentSnap = await ticketsRef.where(TICKET_REPLY_WAITING_SENT_AT, ">", epoch).get();
  for (const doc of ticketSentSnap.docs) {
    const data = doc.data() as { status?: string };
    const st = (data.status ?? "").trim().toLowerCase();
    if (st !== "waiting_client") {
      await doc.ref.update({ [TICKET_REPLY_WAITING_SENT_AT]: FieldValue.delete() });
      supportWaiting.cleared += 1;
      console.log("[client-notifications] cleared ticket reply-waiting flag", { tenantId, ticketId: doc.id });
    }
  }

  // --- overdue_invoice (portal notifications + one email per invoice spell) ---
  const overdueResult = await generateOverdueInvoiceNotifications(tenantId, tenantName, now);
  Object.assign(overdueInvoice, overdueResult.metrics);
  console.log("[client-notifications] overdue portal upserts", {
    tenantId,
    portalNotificationsUpserted: overdueResult.portalNotificationsUpserted,
  });

  // --- service_waiting_client (canonical + common stored variants) ---
  const serviceEligible = (raw: Record<string, unknown>) => {
    const data = raw as { health?: string };
    return normalizeServiceHealth(data.health) === "waiting_client";
  };

  const healthWaitingVariants = ["waiting_client", "waiting client", "waiting-on-client"];
  const svcWaitingSnap = await servicesRef.where("health", "in", healthWaitingVariants).limit(500).get();
  for (const doc of svcWaitingSnap.docs) {
    const raw = doc.data() as Record<string, unknown>;
    const data = raw as {
      clientId?: string;
      health?: string;
      healthNote?: string;
      nextAction?: string;
      name?: string;
      category?: string;
      categoryLabel?: string;
    };
    if (!serviceEligible(raw)) continue;
    if (raw[SERVICE_WAITING_CLIENT_SENT_AT] != null) {
      serviceWaiting.skip.alreadyNotified += 1;
      continue;
    }

    const clientId = data.clientId;
    if (!clientId) {
      serviceWaiting.skip.missingClientId += 1;
      console.warn("[client-notifications] service_waiting skip missingClientId", { tenantId, serviceId: doc.id });
      continue;
    }

    const clientSnap = await db.collection("tenants").doc(tenantId).collection("clients").doc(clientId).get();
    if (!clientSnap.exists) {
      serviceWaiting.failed += 1;
      console.error("[client-notifications] service_waiting fail clientNotFound", { tenantId, clientId, serviceId: doc.id });
      continue;
    }
    const client = clientSnap.data() as { email?: string; name?: string };
    const to = client.email?.trim();
    if (!to) {
      serviceWaiting.skip.missingEmail += 1;
      console.warn("[client-notifications] service_waiting skip missingEmail", { tenantId, clientId, serviceId: doc.id });
      continue;
    }

    const serviceName = getManagedServiceDisplayName({
      name: data.name,
      category: data.category,
      categoryLabel: data.categoryLabel,
    });
    const healthNote = (data.healthNote ?? "").trim();
    const nextAction = (data.nextAction ?? "").trim();
    const serviceUrl = getClientServicePortalUrl(doc.id);
    const clientName = client.name?.trim() || clientId;

    const claim = await tryClaimNotificationDedupe(db, doc.ref, SERVICE_WAITING_CLIENT_SENT_AT, serviceEligible);
    if (claim === "already_notified") {
      serviceWaiting.skip.alreadyNotified += 1;
      continue;
    }
    if (claim !== "claimed") {
      serviceWaiting.skip.claimNotTaken += 1;
      console.log("[client-notifications] service_waiting skip claimNotTaken", {
        tenantId,
        serviceId: doc.id,
        outcome: claim,
        dedupeField: SERVICE_WAITING_CLIENT_SENT_AT,
      });
      continue;
    }

    try {
      await sendClientServiceWaitingEmail({
        to,
        clientName,
        tenantName,
        serviceName,
        healthNote,
        nextAction,
        serviceUrl,
      });
      serviceWaiting.sent += 1;
      console.log("[client-notifications] service_waiting ok sent", {
        tenantId,
        serviceId: doc.id,
        to,
        dedupeField: SERVICE_WAITING_CLIENT_SENT_AT,
        portalUrl: serviceUrl,
      });
    } catch (e) {
      await doc.ref.update({ [SERVICE_WAITING_CLIENT_SENT_AT]: FieldValue.delete() }).catch(() => {});
      serviceWaiting.failed += 1;
      console.error("[client-notifications] service_waiting fail send", {
        tenantId,
        serviceId: doc.id,
        dedupeField: SERVICE_WAITING_CLIENT_SENT_AT,
        err: e instanceof Error ? e.message : e,
      });
    }
  }

  // --- support_waiting_client ---
  const ticketEligible = (raw: Record<string, unknown>) => {
    const data = raw as { status?: string };
    return (data.status ?? "").trim().toLowerCase() === "waiting_client";
  };

  const ticketWaitingSnap = await ticketsRef.where("status", "==", "waiting_client").limit(500).get();
  for (const doc of ticketWaitingSnap.docs) {
    const raw = doc.data() as Record<string, unknown>;
    const data = raw as {
      clientId?: string;
      status?: string;
      subject?: string;
      title?: string;
    };
    if (!ticketEligible(raw)) continue;
    if (raw[TICKET_REPLY_WAITING_SENT_AT] != null) {
      supportWaiting.skip.alreadyNotified += 1;
      continue;
    }

    const clientId = data.clientId;
    if (!clientId) {
      supportWaiting.skip.missingClientId += 1;
      console.warn("[client-notifications] support_waiting skip missingClientId", { tenantId, ticketId: doc.id });
      continue;
    }

    const clientSnap = await db.collection("tenants").doc(tenantId).collection("clients").doc(clientId).get();
    if (!clientSnap.exists) {
      supportWaiting.failed += 1;
      console.error("[client-notifications] support_waiting fail clientNotFound", { tenantId, clientId, ticketId: doc.id });
      continue;
    }
    const client = clientSnap.data() as { email?: string; name?: string };
    const to = client.email?.trim();
    if (!to) {
      supportWaiting.skip.missingEmail += 1;
      console.warn("[client-notifications] support_waiting skip missingEmail", { tenantId, clientId, ticketId: doc.id });
      continue;
    }

    const ticketSubject = (data.subject ?? data.title ?? "Support ticket").trim() || "Support ticket";
    const ticketUrl = getClientSupportTicketPortalUrl(doc.id);
    const clientName = client.name?.trim() || clientId;

    const claim = await tryClaimNotificationDedupe(db, doc.ref, TICKET_REPLY_WAITING_SENT_AT, ticketEligible);
    if (claim === "already_notified") {
      supportWaiting.skip.alreadyNotified += 1;
      continue;
    }
    if (claim !== "claimed") {
      supportWaiting.skip.claimNotTaken += 1;
      console.log("[client-notifications] support_waiting skip claimNotTaken", {
        tenantId,
        ticketId: doc.id,
        outcome: claim,
        dedupeField: TICKET_REPLY_WAITING_SENT_AT,
      });
      continue;
    }

    try {
      await sendClientSupportReplyWaitingEmail({
        to,
        clientName,
        tenantName,
        ticketSubject,
        ticketUrl,
      });
      supportWaiting.sent += 1;
      console.log("[client-notifications] support_waiting ok sent", {
        tenantId,
        ticketId: doc.id,
        to,
        dedupeField: TICKET_REPLY_WAITING_SENT_AT,
        portalUrl: ticketUrl,
      });
    } catch (e) {
      await doc.ref.update({ [TICKET_REPLY_WAITING_SENT_AT]: FieldValue.delete() }).catch(() => {});
      supportWaiting.failed += 1;
      console.error("[client-notifications] support_waiting fail send", {
        tenantId,
        ticketId: doc.id,
        dedupeField: TICKET_REPLY_WAITING_SENT_AT,
        err: e instanceof Error ? e.message : e,
      });
    }
  }

  console.log("[client-notifications] tenant summary", {
    tenantId,
    overdueInvoice,
    serviceWaiting,
    supportWaiting,
  });

  return {
    tenantId,
    overdueInvoice,
    serviceWaiting,
    supportWaiting,
  };
}

export async function processClientNotificationsAllTenants(): Promise<ProcessClientNotificationsResult> {
  const db = adminDb();
  const ranAt = new Date().toISOString();
  const tenantsSnap = await db.collection("tenants").get();
  const tenantIds = tenantsSnap.docs.map((d) => d.id);

  const totals = {
    overdueInvoice: emptyChannelMetrics(),
    serviceWaiting: emptyChannelMetrics(),
    supportWaiting: emptyChannelMetrics(),
  };
  const results: ClientNotificationsTenantResult[] = [];
  const errors: Array<{ tenantId: string; message: string }> = [];

  for (const tenantId of tenantIds) {
    try {
      const r = await processClientNotificationsForTenant(tenantId);
      results.push(r);
      for (const k of ["overdueInvoice", "serviceWaiting", "supportWaiting"] as const) {
        totals[k].sent += r[k].sent;
        totals[k].failed += r[k].failed;
        totals[k].cleared += r[k].cleared;
        mergeSkip(totals[k].skip, r[k].skip);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("[client-notifications] tenant failed", tenantId, e);
      errors.push({ tenantId, message });
      results.push({
        tenantId,
        overdueInvoice: emptyChannelMetrics(),
        serviceWaiting: emptyChannelMetrics(),
        supportWaiting: emptyChannelMetrics(),
      });
    }
  }

  console.log("[client-notifications] run summary", {
    ranAt,
    tenantCount: tenantIds.length,
    totals,
    tenantErrors: errors.length,
  });

  return { ranAt, tenantCount: tenantIds.length, totals, results, errors };
}
