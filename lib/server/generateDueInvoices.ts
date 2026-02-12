import "server-only";
import { adminDb } from "@/lib/firebaseAdmin";
import { sendClientInvoicesEmail } from "@/lib/mailer";

type SubStatus = "active" | "paused" | "cancelled";
type Interval = "monthly" | "yearly";

function addMonthsSafe(base: Date, months: number) {
  const year = base.getFullYear();
  const month = base.getMonth();
  const day = base.getDate();

  const target = new Date(
    year,
    month + months,
    1,
    base.getHours(),
    base.getMinutes(),
    base.getSeconds(),
    base.getMilliseconds()
  );
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, lastDay));
  return target;
}

function addYearsSafe(base: Date, years: number) {
  const target = new Date(base);
  target.setFullYear(base.getFullYear() + years);

  if (base.getMonth() === 1 && base.getDate() === 29 && target.getMonth() !== 1) {
    target.setMonth(1);
    target.setDate(28);
  }
  return target;
}

function advanceNextBillingDate(oldNext: Date, interval: Interval) {
  if (interval === "monthly") return addMonthsSafe(oldNext, 1);
  if (interval === "yearly") return addYearsSafe(oldNext, 1);
  return oldNext;
}

function ymKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`; // YYYY-MM
}

export type GenerateDueInvoicesResult = {
  dueCount: number;
  generatedCount: number;
  skippedCount: number;
  errorsCount: number;
  errors: Array<{ subscriptionId: string; message: string; code: unknown }>;
  email: {
    attempted: boolean;
    sentCount: number;
    failedCount: number;
    details: Array<{
      clientId: string;
      sent: boolean;
      to?: string;
      error?: string;
      code?: unknown;
      response?: string;
    }>;
  };
};

export async function generateDueInvoicesForTenant(tenantId: string): Promise<GenerateDueInvoicesResult> {
  const db = adminDb();

  const now = new Date();
  const subsRef = db.collection("tenants").doc(tenantId).collection("subscriptions");

  const dueSnap = await subsRef
    .where("status", "==", "active")
    .where("nextBillingDate", "<=", now)
    .get();

  const dueCount = dueSnap.size;

  let generatedCount = 0;
  let skippedCount = 0;
  let errorsCount = 0;
  const errors: Array<{ subscriptionId: string; message: string; code: unknown }> = [];

  const createdInvoicesByClient: Record<
    string,
    Array<{
      invoiceId: string;
      invoiceLabel: string;
      amount: number;
      currency: string;
      dueDate: string;
    }>
  > = {};

  for (const subDoc of dueSnap.docs) {
    const subscriptionId = subDoc.id;

    try {
      await db.runTransaction(async (tx) => {
        const fresh = await tx.get(subDoc.ref);
        if (!fresh.exists) return;

        const sub = fresh.data() as {
          status?: string;
          nextBillingDate?: { toDate?: () => Date };
          interval?: string;
          clientId?: string;
          clientName?: string;
          name?: string;
          price?: number;
          currency?: string;
        };

        const subStatus = sub.status as SubStatus;
        if (subStatus !== "active") return;

        if (!sub.clientId || !sub.name || typeof sub.price !== "number" || !sub.interval) {
          throw new Error("Subscription missing required fields (clientId/name/price/interval)");
        }
        if (sub.interval !== "monthly" && sub.interval !== "yearly") {
          throw new Error(`Invalid interval: ${sub.interval}`);
        }

        const oldNextBillingDate: Date = sub.nextBillingDate?.toDate
          ? sub.nextBillingDate.toDate()
          : new Date((sub.nextBillingDate as unknown) as string);

        if (oldNextBillingDate.getTime() > now.getTime()) return;

        const billingYM = ymKey(oldNextBillingDate);
        const billingKey = `sub_${subscriptionId}_${billingYM}`;

        const invoiceRef = db
          .collection("tenants")
          .doc(tenantId)
          .collection("invoices")
          .doc(billingKey);

        const existingInvoice = await tx.get(invoiceRef);
        if (existingInvoice.exists) {
          skippedCount += 1;
          return;
        }

        const issueDate = new Date();
        const dueDate = new Date(issueDate);
        dueDate.setDate(dueDate.getDate() + 7);

        const interval = sub.interval as Interval;
        const newNextBillingDate = advanceNextBillingDate(oldNextBillingDate, interval);

        tx.set(invoiceRef, {
          clientId: sub.clientId,
          title: sub.name,
          amount: sub.price ?? 0,
          currency: sub.currency || "USD",
          status: "unpaid",
          issueDate,
          dueDate,
          source: "subscription",
          subscriptionId,
          billingKey,
          invoiceNumber: billingKey,
          createdAt: new Date(),
        });

        tx.update(subDoc.ref, {
          nextBillingDate: newNextBillingDate,
          updatedAt: new Date(),
        });

        generatedCount += 1;

        const invoiceLabel = billingKey.startsWith("sub_")
          ? `SUB-${billingKey.split("_").pop()}`
          : billingKey;
        const dueDateStr = new Date(dueDate).toLocaleDateString("en-US");

        if (!createdInvoicesByClient[sub.clientId]) createdInvoicesByClient[sub.clientId] = [];
        createdInvoicesByClient[sub.clientId].push({
          invoiceId: invoiceRef.id,
          invoiceLabel,
          amount: sub.price ?? 0,
          currency: sub.currency || "USD",
          dueDate: dueDateStr,
        });
      });
    } catch (e: unknown) {
      errorsCount += 1;
      console.error("Generate invoice failed for subscription:", subscriptionId, e);
      errors.push({
        subscriptionId,
        message: e instanceof Error ? e.message : String(e),
        code: e && typeof e === "object" && "code" in e ? (e as { code: unknown }).code : null,
      });
    }
  }

  let emailSentCount = 0;
  let emailFailedCount = 0;
  const emailDetails: Array<{
    clientId: string;
    sent: boolean;
    to?: string;
    error?: string;
    code?: unknown;
    response?: string;
  }> = [];

  const clientIds = Object.keys(createdInvoicesByClient);

  if (clientIds.length > 0) {
    const tenantSnap = await db.collection("tenants").doc(tenantId).get();
    const tenantName = tenantSnap.exists
      ? (tenantSnap.data() as { name?: string })?.name || tenantId
      : tenantId;

    for (const clientId of clientIds) {
      try {
        const clientSnap = await db
          .collection("tenants")
          .doc(tenantId)
          .collection("clients")
          .doc(clientId)
          .get();
        if (!clientSnap.exists) {
          emailFailedCount++;
          emailDetails.push({ clientId, sent: false, error: "Client doc not found" });
          continue;
        }

        const client = clientSnap.data() as { email?: string; name?: string };
        const to = client?.email;
        const clientName = client?.name || clientId;

        if (!to) {
          emailFailedCount++;
          emailDetails.push({ clientId, sent: false, error: "Client email missing" });
          continue;
        }

        await sendClientInvoicesEmail({
          to,
          clientName,
          tenantName,
          items: createdInvoicesByClient[clientId],
        });

        emailSentCount++;
        emailDetails.push({ clientId, sent: true, to });
      } catch (e: unknown) {
        const err = e as { message?: string; code?: unknown; response?: string };
        emailFailedCount++;
        emailDetails.push({
          clientId,
          sent: false,
          error: err?.message || String(e),
          code: err?.code ?? null,
          response: err?.response ?? undefined,
        });
        console.error("Client email failed:", clientId, e);
      }
    }
  }

  return {
    dueCount,
    generatedCount,
    skippedCount,
    errorsCount,
    errors,
    email: {
      attempted: generatedCount > 0,
      sentCount: emailSentCount,
      failedCount: emailFailedCount,
      details: emailDetails,
    },
  };
}
