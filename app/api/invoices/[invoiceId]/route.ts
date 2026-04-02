import "server-only";
import { NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebaseAdmin";
import { clientVisibleInvoiceSignature, hasMeaningfulClientVisibleInvoiceChange } from "@/lib/server/invoiceClientVisible";
import { notifyInvoiceUpdatedIfMeaningful } from "@/lib/server/invoiceNotify";
import { requireBearerUid } from "@/lib/server/resolvePortalUser";
import { assertStaffCanManageInvoices } from "@/lib/server/tenantInvoiceAccess";

const PATCHABLE = new Set([
  "invoiceNumber",
  "number",
  "dueDate",
  "status",
  "currency",
  "amount",
  "subtotal",
  "total",
  "tax",
  "taxAmount",
  "notes",
  "lineItems",
  "title",
  "clientId",
  "clientName",
  "issueDate",
]);

type LineItem = { description: string; amount: number; currency?: string };

function parseLineItems(raw: unknown): LineItem[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) throw new Error("lineItems must be an array");
  const out: LineItem[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") throw new Error("Invalid line item");
    const d = (row as { description?: unknown }).description;
    const a = (row as { amount?: unknown }).amount;
    if (typeof d !== "string" || !d.trim()) throw new Error("Line item needs description");
    const amt = typeof a === "number" ? a : Number(a);
    if (!Number.isFinite(amt)) throw new Error("Line item needs numeric amount");
    const cur = (row as { currency?: unknown }).currency;
    out.push({
      description: d.trim(),
      amount: amt,
      ...(typeof cur === "string" && cur.trim() ? { currency: cur.trim().toUpperCase() } : {}),
    });
  }
  return out;
}

function buildFirestoreUpdates(body: Record<string, unknown>): Record<string, unknown> {
  const updates: Record<string, unknown> = {};
  for (const key of Object.keys(body)) {
    if (!PATCHABLE.has(key)) continue;
    const v = body[key];
    if (v === undefined) continue;

    if (key === "dueDate" || key === "issueDate") {
      if (v === null) {
        updates[key] = null;
        continue;
      }
      if (typeof v === "string") {
        const d = new Date(v);
        if (Number.isNaN(d.getTime())) throw new Error(`Invalid ${key}`);
        updates[key] = Timestamp.fromDate(d);
        continue;
      }
      throw new Error(`${key} must be ISO string or null`);
    }

    if (key === "notes") {
      updates[key] = v === null ? null : typeof v === "string" ? v.trim() || null : String(v);
      continue;
    }

    if (key === "lineItems") {
      updates[key] = parseLineItems(v);
      continue;
    }

    if (key === "amount" || key === "subtotal" || key === "total" || key === "tax" || key === "taxAmount") {
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isFinite(n)) throw new Error(`Invalid ${key}`);
      updates[key] = n;
      continue;
    }

    if (key === "currency") {
      updates[key] = typeof v === "string" ? v.trim().toUpperCase() : v;
      continue;
    }

    if (key === "status") {
      const s = String(v).trim().toLowerCase();
      if (!["unpaid", "paid", "overdue", "sent"].includes(s)) throw new Error("Invalid status");
      updates[key] = s;
      continue;
    }

    if (typeof v === "string") {
      updates[key] = v.trim();
      continue;
    }

    updates[key] = v;
  }
  return updates;
}

export async function PATCH(req: Request, { params }: { params: Promise<{ invoiceId: string }> }) {
  try {
    const uid = await requireBearerUid(req);
    const { invoiceId } = await params;
    if (!invoiceId) {
      return NextResponse.json({ error: "invoiceId required" }, { status: 400 });
    }

    const body = (await req.json()) as { tenantId?: string; [k: string]: unknown };
    const tenantId = typeof body.tenantId === "string" ? body.tenantId.trim() : "";
    if (!tenantId) {
      return NextResponse.json({ error: "tenantId required" }, { status: 400 });
    }

    await assertStaffCanManageInvoices(uid, tenantId);

    let firestoreUpdates: Record<string, unknown>;
    try {
      firestoreUpdates = buildFirestoreUpdates(body);
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Invalid payload" }, { status: 400 });
    }

    if (Object.keys(firestoreUpdates).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    const db = adminDb();
    const ref = db.collection("tenants").doc(tenantId).collection("invoices").doc(invoiceId);
    const beforeSnap = await ref.get();
    if (!beforeSnap.exists) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    const before = beforeSnap.data() as Record<string, unknown>;

    if (typeof firestoreUpdates.clientId === "string") {
      const cid = firestoreUpdates.clientId as string;
      const cSnap = await db.collection("tenants").doc(tenantId).collection("clients").doc(cid).get();
      if (!cSnap.exists) {
        return NextResponse.json({ error: "Client not found" }, { status: 404 });
      }
    }

    const mergedForSig: Record<string, unknown> = { ...before, ...firestoreUpdates };
    const meaningful = hasMeaningfulClientVisibleInvoiceChange(before, mergedForSig);
    const nextHash = clientVisibleInvoiceSignature(mergedForSig);

    await ref.update({
      ...firestoreUpdates,
      updatedAt: FieldValue.serverTimestamp(),
      lastClientVisibleHash: nextHash,
    });

    const afterSnap = await ref.get();
    const after = (afterSnap.data() ?? {}) as Record<string, unknown>;

    if (meaningful) {
      await notifyInvoiceUpdatedIfMeaningful(tenantId, invoiceId, before, after);
    }

    return NextResponse.json({ ok: true, notified: meaningful });
  } catch (e) {
    const status = typeof (e as { status?: number }).status === "number" ? (e as { status: number }).status : 500;
    if (status === 401) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (status === 403) {
      return NextResponse.json({ error: (e as Error).message || "Forbidden" }, { status: 403 });
    }
    console.error("[api/invoices PATCH]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Server error" }, { status: 500 });
  }
}
