import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebaseAdmin";
import { clientVisibleInvoiceSignature } from "@/lib/server/invoiceClientVisible";
import {
  sendInvoiceCreatedEmail,
  sendInvoiceUpdatedEmail,
} from "@/lib/mailer";
import { upsertNotification } from "@/lib/server/notifications";
import { getClientUsers } from "@/lib/server/tenantUsers";

function formatDueDateLabel(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "string") return v;
  if (typeof (v as { toDate?: () => Date }).toDate === "function") {
    try {
      return (v as { toDate: () => Date }).toDate().toLocaleDateString(undefined, { dateStyle: "medium" });
    } catch {
      return "—";
    }
  }
  if (v instanceof Date) return v.toLocaleDateString(undefined, { dateStyle: "medium" });
  return String(v);
}

function invoiceLabelFromData(data: Record<string, unknown>, invoiceId: string): string {
  return String(data.invoiceNumber ?? data.number ?? invoiceId);
}

/**
 * In-app + optional client email when an invoice is created (server-side only).
 * Subscription batch runs use skipClientEmail=true because sendClientInvoicesEmail already notifies the client.
 */
export async function notifyInvoiceCreated(
  tenantId: string,
  invoiceId: string,
  invoiceData: Record<string, unknown>,
  options: { skipClientEmail?: boolean } = {}
): Promise<void> {
  const db = adminDb();
  const clientId = invoiceData.clientId as string | undefined;
  if (!clientId) {
    console.warn("[invoice-notify] created skip — missing clientId", { tenantId, invoiceId });
    return;
  }

  const tenantSnap = await db.collection("tenants").doc(tenantId).get();
  const tenantName = tenantSnap.exists
    ? String((tenantSnap.data() as { name?: string })?.name || tenantId)
    : tenantId;

  const clientSnap = await db.collection("tenants").doc(tenantId).collection("clients").doc(clientId).get();
  const client = clientSnap.exists ? (clientSnap.data() as { email?: string; name?: string }) : {};
  const clientName = String(invoiceData.clientName ?? client.name ?? clientId);
  const to = client.email?.trim();

  const label = invoiceLabelFromData(invoiceData, invoiceId);
  const amount = typeof invoiceData.amount === "number" ? invoiceData.amount : Number(invoiceData.amount) || 0;
  const currency = String(invoiceData.currency ?? "USD");
  const dueLabel = formatDueDateLabel(invoiceData.dueDate);

  const portalUsers = await getClientUsers(clientId, tenantId);
  for (const u of portalUsers) {
    try {
      await upsertNotification({
        tenantId,
        type: "invoice_created",
        title: `New invoice: ${label}`,
        body: `A new invoice is available. Amount ${currency} ${amount}. Due ${dueLabel}.`,
        targetType: "user",
        targetUserId: u.uid,
        clientId,
        entityType: "invoice",
        entityId: invoiceId,
        actionUrl: `/client/invoices/${invoiceId}`,
        dedupeKey: `invoice_created:${invoiceId}:${u.uid}`,
      });
    } catch (e) {
      console.error("[invoice-notify] created upsert failed", { tenantId, invoiceId, uid: u.uid, err: e });
    }
  }

  if (options.skipClientEmail) return;
  if (!to) {
    console.warn("[invoice-notify] created email skip — client email missing", { tenantId, invoiceId, clientId });
    return;
  }

  try {
    await sendInvoiceCreatedEmail({
      to,
      clientName,
      tenantName,
      invoiceId,
      invoiceLabel: label,
      amount,
      currency,
      dueDateLabel: dueLabel,
    });
  } catch (e) {
    console.error("[invoice-notify] created email failed", { tenantId, invoiceId, err: e });
  }
}

/**
 * After a staff-driven invoice edit: in-app + one client email when client-visible content changed.
 */
export async function notifyInvoiceUpdatedIfMeaningful(
  tenantId: string,
  invoiceId: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>
): Promise<void> {
  const prevSig = clientVisibleInvoiceSignature(before);
  const nextSig = clientVisibleInvoiceSignature(after);
  if (prevSig === nextSig) return;

  const db = adminDb();
  const clientId = after.clientId as string | undefined;
  if (!clientId) return;

  const tenantSnap = await db.collection("tenants").doc(tenantId).get();
  const tenantName = tenantSnap.exists
    ? String((tenantSnap.data() as { name?: string })?.name || tenantId)
    : tenantId;

  const clientSnap = await db.collection("tenants").doc(tenantId).collection("clients").doc(clientId).get();
  const client = clientSnap.exists ? (clientSnap.data() as { email?: string; name?: string }) : {};
  const clientName = String(after.clientName ?? client.name ?? clientId);
  const to = client.email?.trim();
  const label = invoiceLabelFromData(after, invoiceId);

  const portalUsers = await getClientUsers(clientId, tenantId);
  for (const u of portalUsers) {
    try {
      await upsertNotification({
        tenantId,
        type: "invoice_updated",
        title: `Invoice updated: ${label}`,
        body: "Your invoice was updated. Please review the latest details in the portal.",
        targetType: "user",
        targetUserId: u.uid,
        clientId,
        entityType: "invoice",
        entityId: invoiceId,
        actionUrl: `/client/invoices/${invoiceId}`,
        dedupeKey: `invoice_updated:${invoiceId}:${u.uid}`,
      });
    } catch (e) {
      console.error("[invoice-notify] updated upsert failed", { tenantId, invoiceId, uid: u.uid, err: e });
    }
  }

  if (!to) {
    console.warn("[invoice-notify] updated email skip — client email missing", { tenantId, invoiceId, clientId });
    return;
  }

  try {
    await sendInvoiceUpdatedEmail({
      to,
      clientName,
      tenantName,
      invoiceId,
      invoiceLabel: label,
    });
    await db
      .collection("tenants")
      .doc(tenantId)
      .collection("invoices")
      .doc(invoiceId)
      .update({
        lastInvoiceUpdateEmailSentAt: FieldValue.serverTimestamp(),
      })
      .catch(() => {});
  } catch (e) {
    console.error("[invoice-notify] updated email failed", { tenantId, invoiceId, err: e });
  }
}
