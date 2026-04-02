import "server-only";
import type { DocumentReference, Firestore } from "firebase-admin/firestore";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebaseAdmin";
import { sendClientOverdueInvoiceEmail } from "@/lib/mailer";
import {
  INVOICE_OVERDUE_SENT_AT,
  OVERDUE_EMAIL_SENT_AT,
  OVERDUE_NOTIFIED_AT,
} from "@/lib/server/clientNotificationDedupe";
import { upsertNotification } from "@/lib/server/notifications";
import { getClientUsers } from "@/lib/server/tenantUsers";
import type { NotificationChannelMetrics } from "@/lib/server/clientNotificationMetrics";

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

/** Invoice is still awaiting payment (includes issued-but-unpaid `sent`). */
export function isOpenInvoiceAwaitingPayment(status?: string): boolean {
  const s = (status ?? "").trim().toLowerCase();
  return s === "sent" || s === "unpaid" || s === "overdue";
}

function formatAmount(amount: unknown, currency: unknown): string {
  const n = typeof amount === "number" ? amount : Number(amount);
  const cur = typeof currency === "string" && currency.trim() ? currency.trim() : "USD";
  if (!Number.isFinite(n)) return cur;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: cur }).format(n);
  } catch {
    return `${cur} ${n}`;
  }
}

function formatDateLabel(d: Date): string {
  return d.toLocaleDateString(undefined, { dateStyle: "medium" });
}

type ClaimOutcome = "claimed" | "already_notified" | "not_eligible";

async function tryClaimOverdueEmailDedupe(
  db: Firestore,
  ref: DocumentReference,
  isEligible: (raw: Record<string, unknown>) => boolean
): Promise<ClaimOutcome> {
  try {
    return await db.runTransaction(async (t) => {
      const snap = await t.get(ref);
      if (!snap.exists) return "not_eligible";
      const raw = snap.data() as Record<string, unknown>;
      if (raw[OVERDUE_EMAIL_SENT_AT] != null) return "already_notified";
      if (raw[INVOICE_OVERDUE_SENT_AT] != null) return "already_notified";
      if (!isEligible(raw)) return "not_eligible";
      t.update(ref, { [OVERDUE_EMAIL_SENT_AT]: FieldValue.serverTimestamp() });
      return "claimed";
    });
  } catch (e) {
    console.error("[overdue-invoice-notifications] email dedupe claim failed", {
      path: ref.path,
      err: e instanceof Error ? e.message : e,
    });
    return "not_eligible";
  }
}

export type GenerateOverdueInvoiceNotificationsResult = {
  metrics: NotificationChannelMetrics;
  portalNotificationsUpserted: number;
};

/**
 * Past-due open invoices: normalize status to overdue, upsert per-user portal notifications,
 * send client contact email at most once (overdueEmailSentAt; respects legacy clientOverdueNotificationSentAt).
 */
export async function generateOverdueInvoiceNotifications(
  tenantId: string,
  tenantName: string,
  now: Date
): Promise<GenerateOverdueInvoiceNotificationsResult> {
  const db = adminDb();
  const nowTs = Timestamp.fromDate(now);
  const invoicesRef = db.collection("tenants").doc(tenantId).collection("invoices");

  const metrics: NotificationChannelMetrics = {
    sent: 0,
    failed: 0,
    cleared: 0,
    skip: { alreadyNotified: 0, missingClientId: 0, missingEmail: 0, claimNotTaken: 0 },
  };
  let portalNotificationsUpserted = 0;

  const invoiceEligible = (raw: Record<string, unknown>) => {
    const data = raw as { status?: string; dueDate?: unknown };
    if (!isOpenInvoiceAwaitingPayment(data.status)) return false;
    const due = toDateMaybe(data.dueDate);
    return !!(due && due.getTime() < now.getTime());
  };

  const dueSnap = await invoicesRef.where("dueDate", "<=", nowTs).limit(500).get();

  for (const doc of dueSnap.docs) {
    const raw = doc.data() as Record<string, unknown>;
    const data = raw as {
      clientId?: string;
      clientName?: string;
      status?: string;
      dueDate?: unknown;
      amount?: unknown;
      currency?: string;
      invoiceNumber?: string;
      number?: string;
    };

    if (!invoiceEligible(raw)) continue;

    const statusNorm = (data.status ?? "").trim().toLowerCase();
    const updates: Record<string, unknown> = {};
    if (statusNorm !== "overdue") {
      updates.status = "overdue";
    }
    if (raw[OVERDUE_NOTIFIED_AT] == null) {
      updates[OVERDUE_NOTIFIED_AT] = FieldValue.serverTimestamp();
    }
    if (Object.keys(updates).length > 0) {
      await doc.ref.update(updates).catch((e) => {
        console.error("[overdue-invoice-notifications] invoice status update failed", {
          tenantId,
          invoiceId: doc.id,
          err: e instanceof Error ? e.message : e,
        });
      });
    }

    const clientId = data.clientId;
    if (!clientId) {
      metrics.skip.missingClientId += 1;
      console.warn("[overdue-invoice-notifications] skip missingClientId", { tenantId, invoiceId: doc.id });
      continue;
    }

    const clientSnap = await db.collection("tenants").doc(tenantId).collection("clients").doc(clientId).get();
    if (!clientSnap.exists) {
      metrics.failed += 1;
      console.error("[overdue-invoice-notifications] clientNotFound", { tenantId, clientId, invoiceId: doc.id });
      continue;
    }
    const client = clientSnap.data() as { email?: string; name?: string };
    const to = client.email?.trim();
    if (!to) {
      metrics.skip.missingEmail += 1;
      console.warn("[overdue-invoice-notifications] skip missingClientEmail", { tenantId, clientId, invoiceId: doc.id });
    }

    const invoiceId = doc.id;
    const invoiceNumber = String(data.invoiceNumber ?? data.number ?? doc.id);
    const due = toDateMaybe(data.dueDate)!;
    const amountLabel = formatAmount(data.amount, data.currency);
    const dueDateLabel = formatDateLabel(due);
    const clientName = client.name?.trim() || clientId;

    const portalUsers = await getClientUsers(clientId, tenantId);
    for (const user of portalUsers) {
      try {
        await upsertNotification({
          tenantId,
          type: "invoice_overdue",
          title: `Invoice ${invoiceNumber} is overdue`,
          body: "Payment is overdue. Please review and complete payment.",
          targetType: "user",
          targetUserId: user.uid,
          clientId,
          entityType: "invoice",
          entityId: invoiceId,
          actionUrl: `/client/invoices/${invoiceId}`,
          dedupeKey: `invoice_overdue:${invoiceId}:${user.uid}`,
        });
        portalNotificationsUpserted += 1;
      } catch (e) {
        metrics.failed += 1;
        console.error("[overdue-invoice-notifications] upsert failed", {
          tenantId,
          invoiceId,
          uid: user.uid,
          err: e instanceof Error ? e.message : e,
        });
      }
    }

    const emailAlreadySent =
      raw[OVERDUE_EMAIL_SENT_AT] != null || raw[INVOICE_OVERDUE_SENT_AT] != null;
    if (emailAlreadySent) {
      metrics.skip.alreadyNotified += 1;
      continue;
    }
    if (!to) continue;

    const claim = await tryClaimOverdueEmailDedupe(db, doc.ref, invoiceEligible);
    if (claim === "already_notified") {
      metrics.skip.alreadyNotified += 1;
      continue;
    }
    if (claim !== "claimed") {
      metrics.skip.claimNotTaken += 1;
      continue;
    }

    try {
      await sendClientOverdueInvoiceEmail({
        to,
        clientName,
        tenantName,
        invoiceId,
        invoiceNumber,
        amountLabel,
        dueDateLabel,
      });
      metrics.sent += 1;
      await doc.ref.update({ [INVOICE_OVERDUE_SENT_AT]: FieldValue.delete() }).catch(() => {});
      console.log("[overdue-invoice-notifications] email sent", { tenantId, invoiceId, to });
    } catch (e) {
      await doc.ref.update({ [OVERDUE_EMAIL_SENT_AT]: FieldValue.delete() }).catch(() => {});
      metrics.failed += 1;
      console.error("[overdue-invoice-notifications] email failed", {
        tenantId,
        invoiceId,
        err: e instanceof Error ? e.message : e,
      });
    }
  }

  console.log("[overdue-invoice-notifications] done", { tenantId, portalNotificationsUpserted, metrics });

  return { metrics, portalNotificationsUpserted };
}
