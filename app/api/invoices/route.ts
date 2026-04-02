import "server-only";
import { NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebaseAdmin";
import { notifyInvoiceCreated } from "@/lib/server/invoiceNotify";
import { clientVisibleInvoiceSignature } from "@/lib/server/invoiceClientVisible";
import { requireBearerUid } from "@/lib/server/resolvePortalUser";
import {
  assertStaffCanManageInvoices,
  assertTenantAllowsInvoiceCreate,
} from "@/lib/server/tenantInvoiceAccess";

type LineItem = { description: string; amount: number; currency?: string };

function parseLineItems(raw: unknown): LineItem[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) throw new Error("lineItems must be an array");
  const out: LineItem[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") throw new Error("Invalid line item");
    const d = (row as { description?: unknown; amount?: unknown; currency?: unknown }).description;
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

export async function POST(req: Request) {
  try {
    const uid = await requireBearerUid(req);
    const body = (await req.json()) as {
      tenantId?: string;
      clientId?: string;
      amount?: number;
      currency?: string;
      dueDate?: string;
      notes?: string | null;
      invoiceNumber?: string;
      clientName?: string;
      status?: string;
      lineItems?: unknown;
      source?: string;
    };

    const tenantId = typeof body.tenantId === "string" ? body.tenantId.trim() : "";
    if (!tenantId) {
      return NextResponse.json({ error: "tenantId required" }, { status: 400 });
    }

    await assertStaffCanManageInvoices(uid, tenantId);
    await assertTenantAllowsInvoiceCreate(tenantId);

    const clientId = typeof body.clientId === "string" ? body.clientId.trim() : "";
    if (!clientId) {
      return NextResponse.json({ error: "clientId required" }, { status: 400 });
    }

    const amount = typeof body.amount === "number" ? body.amount : Number(body.amount);
    if (!Number.isFinite(amount) || amount < 0) {
      return NextResponse.json({ error: "Valid amount required" }, { status: 400 });
    }

    const dueRaw = body.dueDate;
    if (!dueRaw || typeof dueRaw !== "string") {
      return NextResponse.json({ error: "dueDate (ISO string) required" }, { status: 400 });
    }
    const due = new Date(dueRaw);
    if (Number.isNaN(due.getTime())) {
      return NextResponse.json({ error: "Invalid dueDate" }, { status: 400 });
    }

    const db = adminDb();
    const clientSnap = await db.collection("tenants").doc(tenantId).collection("clients").doc(clientId).get();
    if (!clientSnap.exists) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    const clientRow = clientSnap.data() as { name?: string; email?: string };
    const clientName =
      typeof body.clientName === "string" && body.clientName.trim()
        ? body.clientName.trim()
        : clientRow.name?.trim() || clientRow.email?.trim() || clientId;

    const currency = (typeof body.currency === "string" && body.currency.trim()
      ? body.currency.trim().toUpperCase()
      : "USD") || "USD";

    const invoiceNumber =
      typeof body.invoiceNumber === "string" && body.invoiceNumber.trim()
        ? body.invoiceNumber.trim()
        : `INV-${Date.now()}`;

    const statusRaw = typeof body.status === "string" ? body.status.trim().toLowerCase() : "unpaid";
    const status = ["unpaid", "paid", "overdue", "sent"].includes(statusRaw) ? statusRaw : "unpaid";

    let lineItems: LineItem[] | undefined;
    try {
      lineItems = parseLineItems(body.lineItems);
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Invalid lineItems" }, { status: 400 });
    }

    const notes =
      body.notes === null || body.notes === undefined
        ? null
        : typeof body.notes === "string"
          ? body.notes.trim() || null
          : null;

    const col = db.collection("tenants").doc(tenantId).collection("invoices");
    const sigSource: Record<string, unknown> = {
      invoiceNumber,
      clientId,
      clientName,
      amount,
      currency,
      status,
      dueDate: Timestamp.fromDate(due),
      notes,
      source: typeof body.source === "string" ? body.source : "manual",
    };
    if (lineItems && lineItems.length > 0) {
      sigSource.lineItems = lineItems;
    }

    const payload: Record<string, unknown> = {
      ...sigSource,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      lastClientVisibleHash: clientVisibleInvoiceSignature(sigSource),
    };

    const ref = await col.add(payload);
    const created = await ref.get();
    const data = (created.data() ?? {}) as Record<string, unknown>;

    await notifyInvoiceCreated(tenantId, ref.id, data, { skipClientEmail: false });

    return NextResponse.json({ ok: true, invoiceId: ref.id });
  } catch (e) {
    const status = typeof (e as { status?: number }).status === "number" ? (e as { status: number }).status : 500;
    if (status === 401) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (status === 403) {
      return NextResponse.json({ error: (e as Error).message || "Forbidden" }, { status: 403 });
    }
    console.error("[api/invoices POST]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Server error" }, { status: 500 });
  }
}
