import "server-only";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebaseAdmin";
import {
  sendClientOverdueInvoiceEmail,
  sendClientServiceWaitingEmail,
  sendClientSupportReplyWaitingEmail,
} from "@/lib/mailer";
import { isUnpaidOrOverdueInvoice } from "@/lib/clientPortalSignals";
import { normalizeServiceHealth } from "@/lib/serviceHealth";
import { getManagedServiceDisplayName } from "@/lib/serviceDisplayName";

/** Dedupe: invoice doc — sent once per overdue spell; cleared when paid or no longer overdue. */
export const INVOICE_OVERDUE_SENT_AT = "clientOverdueNotificationSentAt";
/** Dedupe: service doc — sent once per waiting_client spell; cleared when health changes. */
export const SERVICE_WAITING_CLIENT_SENT_AT = "clientWaitingClientNotificationSentAt";
/** Dedupe: ticket doc — sent once per waiting_client spell; cleared when status changes. */
export const TICKET_REPLY_WAITING_SENT_AT = "clientReplyWaitingNotificationSentAt";

function portalBaseUrl() {
  return (
    process.env.NEXT_PUBLIC_PORTAL_URL ||
    process.env.PORTAL_BASE_URL ||
    "https://portal.blueteamafrica.com"
  ).replace(/\/$/, "");
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

export type ClientNotificationsTenantResult = {
  tenantId: string;
  overdueInvoice: { sent: number; failed: number; cleared: number };
  serviceWaiting: { sent: number; failed: number; cleared: number };
  supportWaiting: { sent: number; failed: number; cleared: number };
};

export type ProcessClientNotificationsResult = {
  ranAt: string;
  tenantCount: number;
  totals: {
    overdueInvoice: { sent: number; failed: number; cleared: number };
    serviceWaiting: { sent: number; failed: number; cleared: number };
    supportWaiting: { sent: number; failed: number; cleared: number };
  };
  results: ClientNotificationsTenantResult[];
  errors: Array<{ tenantId: string; message: string }>;
};

export async function processClientNotificationsForTenant(tenantId: string): Promise<ClientNotificationsTenantResult> {
  const db = adminDb();
  const now = new Date();
  const nowTs = Timestamp.fromDate(now);

  const tenantSnap = await db.collection("tenants").doc(tenantId).get();
  const tenantName = tenantSnap.exists
    ? ((tenantSnap.data() as { name?: string })?.name || tenantId)
    : tenantId;

  const base = portalBaseUrl();

  const overdueInvoice = { sent: 0, failed: 0, cleared: 0 };
  const serviceWaiting = { sent: 0, failed: 0, cleared: 0 };
  const supportWaiting = { sent: 0, failed: 0, cleared: 0 };

  const invoicesRef = db.collection("tenants").doc(tenantId).collection("invoices");
  const servicesRef = db.collection("tenants").doc(tenantId).collection("services");
  const ticketsRef = db.collection("tenants").doc(tenantId).collection("tickets");

  // --- Cleanup stale dedupe flags (state left actionable) ---
  const epoch = Timestamp.fromMillis(0);

  const overdueSentSnap = await invoicesRef.where(INVOICE_OVERDUE_SENT_AT, ">", epoch).get();
  for (const doc of overdueSentSnap.docs) {
    const data = doc.data() as {
      status?: string;
      dueDate?: unknown;
      [key: string]: unknown;
    };
    const due = toDateMaybe(data.dueDate);
    const unpaid = isUnpaidOrOverdueInvoice(data.status);
    const pastDue = due !== null && due.getTime() < now.getTime();
    if (!unpaid || !pastDue) {
      await doc.ref.update({ [INVOICE_OVERDUE_SENT_AT]: FieldValue.delete() });
      overdueInvoice.cleared += 1;
      console.log("[client-notifications] cleared invoice overdue flag", { tenantId, invoiceId: doc.id });
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

  // --- overdue_invoice ---
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

    if (!isUnpaidOrOverdueInvoice(data.status)) continue;
    const due = toDateMaybe(data.dueDate);
    if (!due || due.getTime() >= now.getTime()) continue;
    if (raw[INVOICE_OVERDUE_SENT_AT]) continue;

    const clientId = data.clientId;
    if (!clientId) {
      console.warn("[client-notifications] invoice missing clientId", { tenantId, invoiceId: doc.id });
      continue;
    }

    const clientSnap = await db.collection("tenants").doc(tenantId).collection("clients").doc(clientId).get();
    if (!clientSnap.exists) {
      overdueInvoice.failed += 1;
      console.error("[client-notifications] client not found", { tenantId, clientId });
      continue;
    }
    const client = clientSnap.data() as { email?: string; name?: string };
    const to = client.email?.trim();
    if (!to) {
      console.warn("[client-notifications] client email missing", { tenantId, clientId });
      continue;
    }

    const invoiceNumber = String(data.invoiceNumber ?? data.number ?? doc.id);
    const amountLabel = formatAmount(data.amount, data.currency);
    const dueDateLabel = formatDateLabel(due);
    const clientName = client.name?.trim() || clientId;

    try {
      await sendClientOverdueInvoiceEmail({
        to,
        clientName,
        tenantName,
        invoiceNumber,
        amountLabel,
        dueDateLabel,
      });
      await doc.ref.update({ [INVOICE_OVERDUE_SENT_AT]: FieldValue.serverTimestamp() });
      overdueInvoice.sent += 1;
      console.log("[client-notifications] overdue_invoice sent", { tenantId, invoiceId: doc.id, to });
    } catch (e) {
      overdueInvoice.failed += 1;
      console.error("[client-notifications] overdue_invoice failed", { tenantId, invoiceId: doc.id, err: e });
    }
  }

  // --- service_waiting_client (canonical + common stored variants) ---
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
    if (normalizeServiceHealth(data.health) !== "waiting_client") continue;
    if (raw[SERVICE_WAITING_CLIENT_SENT_AT]) continue;

    const clientId = data.clientId;
    if (!clientId) {
      console.warn("[client-notifications] service missing clientId", { tenantId, serviceId: doc.id });
      continue;
    }

    const clientSnap = await db.collection("tenants").doc(tenantId).collection("clients").doc(clientId).get();
    if (!clientSnap.exists) {
      serviceWaiting.failed += 1;
      console.error("[client-notifications] client not found (service)", { tenantId, clientId });
      continue;
    }
    const client = clientSnap.data() as { email?: string; name?: string };
    const to = client.email?.trim();
    if (!to) {
      console.warn("[client-notifications] client email missing (service)", { tenantId, clientId });
      continue;
    }

    const serviceName = getManagedServiceDisplayName({
      name: data.name,
      category: data.category,
      categoryLabel: data.categoryLabel,
    });
    const healthNote = (data.healthNote ?? "").trim();
    const nextAction = (data.nextAction ?? "").trim();
    const serviceUrl = `${base}/client/services/${doc.id}`;
    const clientName = client.name?.trim() || clientId;

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
      await doc.ref.update({ [SERVICE_WAITING_CLIENT_SENT_AT]: FieldValue.serverTimestamp() });
      serviceWaiting.sent += 1;
      console.log("[client-notifications] service_waiting_client sent", { tenantId, serviceId: doc.id, to });
    } catch (e) {
      serviceWaiting.failed += 1;
      console.error("[client-notifications] service_waiting_client failed", { tenantId, serviceId: doc.id, err: e });
    }
  }

  // --- support_waiting_client ---
  const ticketWaitingSnap = await ticketsRef.where("status", "==", "waiting_client").limit(500).get();
  for (const doc of ticketWaitingSnap.docs) {
    const raw = doc.data() as Record<string, unknown>;
    const data = raw as {
      clientId?: string;
      status?: string;
      subject?: string;
      title?: string;
    };
    if ((data.status ?? "").trim().toLowerCase() !== "waiting_client") continue;
    if (raw[TICKET_REPLY_WAITING_SENT_AT]) continue;

    const clientId = data.clientId;
    if (!clientId) {
      console.warn("[client-notifications] ticket missing clientId", { tenantId, ticketId: doc.id });
      continue;
    }

    const clientSnap = await db.collection("tenants").doc(tenantId).collection("clients").doc(clientId).get();
    if (!clientSnap.exists) {
      supportWaiting.failed += 1;
      console.error("[client-notifications] client not found (ticket)", { tenantId, clientId });
      continue;
    }
    const client = clientSnap.data() as { email?: string; name?: string };
    const to = client.email?.trim();
    if (!to) {
      console.warn("[client-notifications] client email missing (ticket)", { tenantId, clientId });
      continue;
    }

    const ticketSubject = (data.subject ?? data.title ?? "Support ticket").trim() || "Support ticket";
    const ticketUrl = `${base}/client/support/${doc.id}`;
    const clientName = client.name?.trim() || clientId;

    try {
      await sendClientSupportReplyWaitingEmail({
        to,
        clientName,
        tenantName,
        ticketSubject,
        ticketUrl,
      });
      await doc.ref.update({ [TICKET_REPLY_WAITING_SENT_AT]: FieldValue.serverTimestamp() });
      supportWaiting.sent += 1;
      console.log("[client-notifications] support_waiting_client sent", { tenantId, ticketId: doc.id, to });
    } catch (e) {
      supportWaiting.failed += 1;
      console.error("[client-notifications] support_waiting_client failed", { tenantId, ticketId: doc.id, err: e });
    }
  }

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
    overdueInvoice: { sent: 0, failed: 0, cleared: 0 },
    serviceWaiting: { sent: 0, failed: 0, cleared: 0 },
    supportWaiting: { sent: 0, failed: 0, cleared: 0 },
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
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("[client-notifications] tenant failed", tenantId, e);
      errors.push({ tenantId, message });
      results.push({
        tenantId,
        overdueInvoice: { sent: 0, failed: 0, cleared: 0 },
        serviceWaiting: { sent: 0, failed: 0, cleared: 0 },
        supportWaiting: { sent: 0, failed: 0, cleared: 0 },
      });
    }
  }

  return { ranAt, tenantCount: tenantIds.length, totals, results, errors };
}
