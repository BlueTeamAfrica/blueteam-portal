import "server-only";
import { NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { renderInvoicePdfBuffer } from "@/lib/server/renderInvoicePdf";

function formatDueDate(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "string") return value;
  if (typeof (value as { toDate?: () => Date }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate().toLocaleDateString();
  }
  return String(value);
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ invoiceId: string }> }
) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const match = authHeader.match(/^Bearer (.+)$/);
    if (!match) {
      return NextResponse.json({ error: "Missing Authorization Bearer token" }, { status: 401 });
    }

    const token = match[1];
    const decoded = await adminAuth().verifyIdToken(token);
    const uid = decoded.uid;

    const db = adminDb();
    const { invoiceId } = await params;

    let tenantId: string | undefined;
    const userSnap = await db.collection("users").doc(uid).get();
    if (userSnap.exists) {
      tenantId = (userSnap.data() as { tenantId?: string })?.tenantId;
    }
    if (!tenantId) {
      const utSnap = await db.collection("userTenants").where("userId", "==", uid).limit(1).get();
      if (!utSnap.empty) {
        tenantId = utSnap.docs[0].data().tenantId as string;
      }
    }
    if (!tenantId) {
      return NextResponse.json({ error: "User missing tenantId" }, { status: 403 });
    }

    const membershipId = `${uid}_${tenantId}`;
    const memSnap = await db.collection("userTenants").doc(membershipId).get();
    if (!memSnap.exists) {
      return NextResponse.json({ error: "Tenant membership not found" }, { status: 403 });
    }
    const mem = memSnap.data() as { role?: string; status?: string; clientId?: string };
    if (mem.status !== "active") {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    const invRef = db.collection("tenants").doc(tenantId).collection("invoices").doc(invoiceId);
    const invSnap = await invRef.get();
    if (!invSnap.exists) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    const invData = invSnap.data() as {
      clientId?: string;
      clientName?: string;
      invoiceNumber?: string;
      status?: string;
      amount?: number;
      currency?: string;
      dueDate?: unknown;
      notes?: string;
      lineItems?: Array<{ description: string; amount: number; currency?: string }>;
    };

    if (mem.role === "client") {
      if (invData.clientId !== mem.clientId) {
        return NextResponse.json({ error: "Access denied" }, { status: 403 });
      }
    }

    const clientId = invData.clientId;
    if (!clientId) {
      return NextResponse.json({ error: "Invoice has no client" }, { status: 400 });
    }

    const [tenantSnap, clientSnap] = await Promise.all([
      db.collection("tenants").doc(tenantId).get(),
      db.collection("tenants").doc(tenantId).collection("clients").doc(clientId).get(),
    ]);

    const tenantData = tenantSnap.exists ? (tenantSnap.data() as { name?: string }) : {};
    const clientData = clientSnap.exists
      ? (clientSnap.data() as { name?: string; email?: string })
      : { name: invData.clientName, email: undefined };

    const pdfData = {
      tenant: { id: tenantId, name: tenantData.name },
      invoice: {
        invoiceNumber: invData.invoiceNumber ?? `INV-${invoiceId.slice(0, 8)}`,
        clientId: invData.clientId,
        clientName: invData.clientName ?? clientData.name,
        status: invData.status,
        amount: invData.amount,
        currency: invData.currency,
        dueDate: formatDueDate(invData.dueDate),
        notes: invData.notes,
        lineItems: invData.lineItems,
      },
      client: {
        id: clientId,
        name: clientData.name ?? invData.clientName,
        email: clientData.email,
      },
    };

    const pdfBuffer = await renderInvoicePdfBuffer(pdfData);
    const filename = `${pdfData.invoice.invoiceNumber ?? "INV"}.pdf`;

    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 }
    );
  }
}
