import "server-only";
import { NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { sendAdminInvoiceEmail } from "@/lib/mailer";
import { FieldValue } from "firebase-admin/firestore";

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const match = authHeader.match(/^Bearer (.+)$/);
    if (!match) {
      return NextResponse.json({ error: "Missing Authorization Bearer token" }, { status: 401 });
    }

    const token = match[1];
    const decoded = await adminAuth().verifyIdToken(token);
    const uid = decoded.uid;

    let bodyTo: string | undefined;
    try {
      const body = await req.json().catch(() => ({})) as { to?: string };
      bodyTo = body.to?.trim();
    } catch {
      // no body
    }

    const db = adminDb();

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
    const mem = memSnap.data() as { role?: string; status?: string };
    if (mem.status !== "active" || (mem.role !== "owner" && mem.role !== "admin")) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    const settingsRef = db.collection("tenants").doc(tenantId).collection("settings").doc("emailTest");

    // Anti-spam: check last sent (skip when explicit recipient provided)
    if (!bodyTo) {
      const settingsSnap = await settingsRef.get();
      const lastSentAt = settingsSnap.data()?.lastSentAt?.toDate?.() as Date | undefined;
      if (lastSentAt) {
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
        if (lastSentAt > fiveMinutesAgo) {
          return NextResponse.json(
            { error: "Please wait 5 minutes", email: { attempted: false, sent: false, to: null, error: null } },
            { status: 429 }
          );
        }
      }
    }

    let tenantName = tenantId;
    try {
      const tenantSnap = await db.collection("tenants").doc(tenantId).get();
      if (tenantSnap.exists) tenantName = (tenantSnap.data() as { name?: string })?.name || tenantId;
    } catch {
      // ignore
    }

    let emailAttempted = false;
    let emailSent = false;
    let emailTo: string | null = null;
    let emailError: {
      message: string;
      code?: unknown;
      response?: string | null;
      responseCode?: number | string | null;
      command?: string | null;
    } | null = null;

    if (bodyTo) {
      emailTo = bodyTo;
    } else {
      const ownerSnap = await db
        .collection("users")
        .where("tenantId", "==", tenantId)
        .where("role", "==", "owner")
        .limit(1)
        .get();

      if (ownerSnap.empty) {
        const utOwnerSnap = await db
          .collection("userTenants")
          .where("tenantId", "==", tenantId)
          .where("role", "==", "owner")
          .limit(1)
          .get();
        if (!utOwnerSnap.empty) {
          const ownerUserId = utOwnerSnap.docs[0].data().userId as string;
          const ownerUserSnap = await db.collection("users").doc(ownerUserId).get();
          emailTo = (ownerUserSnap.data() as { email?: string })?.email ?? null;
        }
      } else {
        emailTo = (ownerSnap.docs[0].data() as { email?: string })?.email ?? null;
      }
    }

    if (!emailTo) {
      return NextResponse.json({
        email: {
          attempted: false,
          sent: false,
          to: null,
          error: { message: "No owner email found", code: null, response: null, responseCode: null, command: null },
        },
      });
    }

    emailAttempted = true;

    try {
      await sendAdminInvoiceEmail({
        to: emailTo,
        tenantName,
        generated: 1,
        skipped: 0,
        errors: 0,
      });
      emailSent = true;
      await settingsRef.set({ lastSentAt: FieldValue.serverTimestamp() }, { merge: true });
    } catch (e: unknown) {
      const err = e as {
        message?: string;
        code?: unknown;
        response?: string;
        responseCode?: number | string;
        command?: string;
      };
      emailError = {
        message: err?.message || String(e),
        code: err?.code ?? null,
        response: err?.response ?? null,
        responseCode: err?.responseCode ?? null,
        command: err?.command ?? null,
      };
      console.error("Test email failed:", e);
    }

    return NextResponse.json({
      email: {
        attempted: emailAttempted,
        sent: emailSent,
        to: emailTo,
        error: emailError,
      },
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 }
    );
  }
}
