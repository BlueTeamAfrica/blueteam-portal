import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { generateDueInvoicesForTenant } from "@/lib/server/generateDueInvoices";

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
      const result = await generateDueInvoicesForTenant(singleTenantId);
      return NextResponse.json({
        ranAt,
        tenantCount: 1,
        totals: {
          generated: result.generatedCount,
          skipped: result.skippedCount,
          errors: result.errorsCount,
        },
        results: [
          {
            tenantId: singleTenantId,
            dueCount: result.dueCount,
            generatedCount: result.generatedCount,
            skippedCount: result.skippedCount,
            errorsCount: result.errorsCount,
            email: {
              attempted: result.email.attempted,
              sentCount: result.email.sentCount,
              failedCount: result.email.failedCount,
            },
          },
        ],
      });
    } catch (e) {
      console.error("Cron generate-invoices single tenant failed:", singleTenantId, e);
      return NextResponse.json(
        { ranAt, error: e instanceof Error ? e.message : "Generation failed" },
        { status: 500 }
      );
    }
  }

  const db = adminDb();
  const tenantsSnap = await db.collection("tenants").get();
  const tenantIds = tenantsSnap.docs.map((d) => d.id);

  let totalGenerated = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  const results: Array<{
    tenantId: string;
    dueCount: number;
    generatedCount: number;
    skippedCount: number;
    errorsCount: number;
    email: { attempted: boolean; sentCount: number; failedCount: number };
  }> = [];

  for (const tenantId of tenantIds) {
    try {
      const result = await generateDueInvoicesForTenant(tenantId);
      totalGenerated += result.generatedCount;
      totalSkipped += result.skippedCount;
      totalErrors += result.errorsCount;
      results.push({
        tenantId,
        dueCount: result.dueCount,
        generatedCount: result.generatedCount,
        skippedCount: result.skippedCount,
        errorsCount: result.errorsCount,
        email: {
          attempted: result.email.attempted,
          sentCount: result.email.sentCount,
          failedCount: result.email.failedCount,
        },
      });
    } catch (e) {
      console.error("Cron generate-invoices tenant failed:", tenantId, e);
      totalErrors += 1;
      results.push({
        tenantId,
        dueCount: 0,
        generatedCount: 0,
        skippedCount: 0,
        errorsCount: 1,
        email: { attempted: false, sentCount: 0, failedCount: 0 },
      });
    }
  }

  return NextResponse.json({
    ranAt,
    tenantCount: tenantIds.length,
    totals: { generated: totalGenerated, skipped: totalSkipped, errors: totalErrors },
    results,
  });
}
