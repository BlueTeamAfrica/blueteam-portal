import "server-only";
import { NextRequest, NextResponse } from "next/server";
import {
  processClientNotificationsAllTenants,
  processClientNotificationsForTenant,
} from "@/lib/server/processClientNotifications";

export async function GET(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const singleTenantId = searchParams.get("tenantId")?.trim() || undefined;

  const ranAt = new Date().toISOString();

  if (singleTenantId) {
    try {
      const result = await processClientNotificationsForTenant(singleTenantId);
      return NextResponse.json({
        ranAt,
        tenantCount: 1,
        totals: {
          overdueInvoice: result.overdueInvoice,
          serviceWaiting: result.serviceWaiting,
          supportWaiting: result.supportWaiting,
        },
        results: [result],
        errors: [],
      });
    } catch (e) {
      console.error("Cron client-notifications single tenant failed:", singleTenantId, e);
      return NextResponse.json(
        {
          ranAt,
          error: e instanceof Error ? e.message : "Processing failed",
        },
        { status: 500 }
      );
    }
  }

  try {
    const out = await processClientNotificationsAllTenants();
    return NextResponse.json(out);
  } catch (e) {
    console.error("Cron client-notifications failed:", e);
    return NextResponse.json(
      { ranAt, error: e instanceof Error ? e.message : "Processing failed" },
      { status: 500 }
    );
  }
}
