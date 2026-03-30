"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  collection,
  getDocs,
  query,
  where,
  doc,
  getDoc,
  orderBy,
  limit,
  Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/authContext";
import { useTenant } from "@/lib/tenantContext";
import {
  bucketServiceHealthForCounts,
  getServiceHealthLabel,
  isAttentionServiceHealth,
  normalizeServiceHealth,
} from "@/lib/serviceHealth";

type RecentActivityItem = {
  id: string;
  title: string;
  subtitle?: string;
  dateLabel: string;
  icon: string;
  timestamp?: Date;
};

function getBillingTypeLabel(v?: string) {
  const s = (v ?? "").toLowerCase();
  if (s === "none") return "Not billable";
  if (s === "one_time") return "One-time";
  if (s === "recurring") return "Recurring";
  return v ? v : "—";
}

type ClientHealthOverview = {
  counts: {
    healthy: number;
    warning: number;
    critical: number;
    waiting_client: number;
    paused: number;
  };
  attention: Array<{
    id: string;
    name: string;
    clientName: string;
    health: string;
    nextAction?: string;
    nextActionDueLabel: string;
  }>;
};

function formatServiceDue(ts?: Timestamp | null) {
  if (!ts) return "—";
  try {
    if (typeof ts.toDate === "function") {
      return ts.toDate().toLocaleDateString(undefined, { dateStyle: "medium" });
    }
  } catch {
    /* ignore */
  }
  return "—";
}

function HealthOverviewBadge({ health }: { health?: string }) {
  const h = normalizeServiceHealth(health);
  const styles =
    h === "healthy"
      ? "bg-emerald-100 text-emerald-800"
      : h === "warning"
        ? "bg-amber-100 text-amber-800"
        : h === "critical"
          ? "bg-rose-100 text-rose-800"
          : h === "waiting_client"
            ? "bg-indigo-100 text-indigo-800"
            : h === "paused"
              ? "bg-slate-200 text-slate-700"
              : "bg-slate-100 text-slate-600";
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold ${styles}`}>
      {getServiceHealthLabel(health)}
    </span>
  );
}

export default function ClientDashboardPage() {
  const { user } = useAuth();
  const { tenant, role, clientId } = useTenant();
  const [clientName, setClientName] = useState<string>("");
  const [activeProjects, setActiveProjects] = useState<number>(0);
  const [unpaidInvoices, setUnpaidInvoices] = useState<number>(0);
  const [totalInvoices, setTotalInvoices] = useState<number>(0);
  const [recentActivity, setRecentActivity] = useState<RecentActivityItem[]>([]);
  const [serviceHealthOverview, setServiceHealthOverview] = useState<ClientHealthOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    const tenantId: string | undefined = tenant?.id;
    const clientIdStr: string | undefined = clientId;
    if (!user || !tenantId || role !== "client" || !clientIdStr) {
      setLoading(false);
      return;
    }

    async function load() {
      setLoading(true);
      try {
        const clientDoc = await getDoc(doc(db, "tenants", tenantId as string, "clients", clientIdStr as string));
        const resolvedClientName = (clientDoc.data()?.name as string) ?? "Client";
        setClientName(resolvedClientName);

        const projectsQuery = query(
          collection(db, "tenants", tenantId as string, "projects"),
          where("clientId", "==", clientIdStr)
        );
        const projectsSnap = await getDocs(projectsQuery);
        const projects = projectsSnap.docs.map((d) => ({ status: d.data().status }));
        setActiveProjects(projects.filter((p) => p.status === "active").length);

        const allInvoicesQuery = query(
          collection(db, "tenants", tenantId as string, "invoices"),
          where("clientId", "==", clientIdStr)
        );
        const unpaidQuery = query(
          collection(db, "tenants", tenantId as string, "invoices"),
          where("clientId", "==", clientIdStr),
          where("status", "==", "unpaid")
        );
        const [allSnap, unpaidSnap] = await Promise.all([
          getDocs(allInvoicesQuery),
          getDocs(unpaidQuery),
        ]);
        setTotalInvoices(allSnap.size);
        setUnpaidInvoices(unpaidSnap.size);

        const allServicesForHealth = await getDocs(
          query(
            collection(db, "tenants", tenantId as string, "services"),
            where("clientId", "==", clientIdStr)
          )
        );
        const counts = {
          healthy: 0,
          warning: 0,
          critical: 0,
          waiting_client: 0,
          paused: 0,
        };
        type AttentionSort = ClientHealthOverview["attention"][number] & { _due: number };
        const attentionSort: AttentionSort[] = [];

        allServicesForHealth.forEach((d) => {
          const data = d.data() as {
            name?: string;
            clientName?: string;
            health?: string;
            nextAction?: string;
            nextActionDue?: Timestamp | null;
          };
          const bucket = bucketServiceHealthForCounts(data.health);
          counts[bucket] += 1;

          if (isAttentionServiceHealth(data.health)) {
            let dueMs = Infinity;
            const due = data.nextActionDue;
            if (due && typeof due.toDate === "function") {
              try {
                dueMs = due.toDate().getTime();
              } catch {
                dueMs = Infinity;
              }
            }
            attentionSort.push({
              id: d.id,
              name: data.name?.trim() ? data.name.trim() : "Untitled service",
              clientName: data.clientName?.trim() ? data.clientName.trim() : resolvedClientName,
              health: data.health ?? "",
              nextAction: data.nextAction?.trim() ? data.nextAction.trim() : undefined,
              nextActionDueLabel: formatServiceDue(data.nextActionDue ?? null),
              _due: dueMs,
            });
          }
        });

        attentionSort.sort((a, b) => {
          if (a._due !== b._due) return a._due - b._due;
          return a.name.localeCompare(b.name);
        });
        const attention: ClientHealthOverview["attention"] = [];
        for (const row of attentionSort.slice(0, 8)) {
          const { _due: _drop, ...rest } = row;
          attention.push(rest);
        }
        setServiceHealthOverview({ counts, attention });

        const [recentInvoicesSnap, recentServicesSnap] = await Promise.all([
          getDocs(
            query(
              collection(db, "tenants", tenantId as string, "invoices"),
              where("clientId", "==", clientIdStr),
              orderBy("createdAt", "desc"),
              limit(6)
            )
          ),
          getDocs(
            query(
              collection(db, "tenants", tenantId as string, "services"),
              where("clientId", "==", clientIdStr),
              orderBy("updatedAt", "desc"),
              limit(6)
            )
          ),
        ]);

        const activity: RecentActivityItem[] = [];

        recentInvoicesSnap.forEach((d) => {
          const data = d.data() as {
            invoiceNumber?: string;
            amount?: number;
            currency?: string;
            createdAt?: { toDate?: () => Date };
          };
          const createdAt =
            data.createdAt && typeof data.createdAt.toDate === "function"
              ? data.createdAt.toDate()
              : undefined;
          activity.push({
            id: `inv_${d.id}`,
            title: data.invoiceNumber ? `Invoice ${data.invoiceNumber} generated` : "Invoice generated",
            subtitle:
              typeof data.amount === "number"
                ? `${data.currency ?? "USD"} ${data.amount.toLocaleString()}`
                : undefined,
            dateLabel: createdAt
              ? createdAt.toLocaleDateString(undefined, { month: "short", day: "numeric" })
              : "—",
            icon: "💸",
            timestamp: createdAt,
          });
        });

        recentServicesSnap.forEach((d) => {
          const data = d.data() as {
            name?: string;
            billingType?: string;
            subscriptionId?: string;
            createdAt?: { toDate?: () => Date };
            updatedAt?: { toDate?: () => Date };
          };
          const createdAt =
            data.createdAt && typeof data.createdAt.toDate === "function"
              ? data.createdAt.toDate()
              : undefined;
          const updatedAt =
            data.updatedAt && typeof data.updatedAt.toDate === "function"
              ? data.updatedAt.toDate()
              : createdAt;
          const bt = (data.billingType ?? "").toLowerCase();

          if (createdAt) {
            activity.push({
              id: `svc_${d.id}_created`,
              title: data.name ? `Service "${data.name}" created` : "Service created",
              subtitle: `Billing: ${getBillingTypeLabel(data.billingType)}`,
              dateLabel: createdAt.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
              icon: "🛠️",
              timestamp: createdAt,
            });
          }

          if (updatedAt && createdAt && updatedAt.getTime() - createdAt.getTime() > 2 * 60 * 1000) {
            activity.push({
              id: `svc_${d.id}_updated`,
              title: data.name ? `Service "${data.name}" updated` : "Service updated",
              subtitle: `Billing: ${getBillingTypeLabel(data.billingType)}`,
              dateLabel: updatedAt.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
              icon: "🧾",
              timestamp: updatedAt,
            });
          }

          if (updatedAt && bt === "recurring") {
            activity.push({
              id: `svc_${d.id}_recurring`,
              title: data.name ? `Service "${data.name}" set to Recurring` : "Service set to Recurring",
              subtitle: data.subscriptionId ? "Subscription linked" : undefined,
              dateLabel: updatedAt.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
              icon: "💳",
              timestamp: updatedAt,
            });
          }
        });

        const sorted = activity
          .slice()
          .sort((a, b) => (b.timestamp ? b.timestamp.getTime() : 0) - (a.timestamp ? a.timestamp.getTime() : 0))
          .slice(0, 15);
        setRecentActivity(sorted);
      } catch (err) {
        setError("Unable to load dashboard data. Please try again.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [user, tenant?.id, role, clientId]);

  if (!user) return <p className="text-[#0F172A]">Please log in</p>;
  if (!tenant) return <p className="text-[#0F172A]">Loading tenant…</p>;
  if (role !== "client" || !clientId) return <p className="text-[#0F172A]">Access denied.</p>;
  if (loading) return <p className="text-[#0F172A]">Loading…</p>;
  if (error) return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
      <p className="text-red-600">{error}</p>
    </div>
  );

  return (
    <div>
      <h1 className="text-[#0F172A] text-2xl font-semibold">Dashboard</h1>
      <p className="text-slate-600 mt-1">{clientName}</p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <div className="text-xs uppercase tracking-wide text-slate-500">Active Projects</div>
          <div className="text-2xl font-semibold text-[#0F172A] mt-1">{activeProjects}</div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <div className="text-xs uppercase tracking-wide text-red-600">Unpaid Invoices</div>
          <div className="text-2xl font-semibold text-[#0F172A] mt-1">{unpaidInvoices}</div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <div className="text-xs uppercase tracking-wide text-slate-500">Total Invoices</div>
          <div className="text-2xl font-semibold text-[#0F172A] mt-1">{totalInvoices}</div>
        </div>
      </div>

      {serviceHealthOverview && (
        <div className="mt-6 rounded-2xl border border-slate-200/80 bg-gradient-to-br from-slate-50 via-white to-indigo-50/40 shadow-sm overflow-hidden max-w-full">
          <div className="px-4 py-3 sm:px-6 sm:py-4 border-b border-slate-200/80 bg-slate-900/[0.04] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <h2 className="text-[#0F172A] text-lg font-semibold tracking-tight">Service Health Overview</h2>
              <p className="text-xs text-slate-600 mt-0.5 max-w-xl">
                Your managed services at a glance. Unset status counts as{" "}
                <span className="font-medium text-slate-700">Healthy</span>.
              </p>
            </div>
            <Link
              href="/client/services"
              className="inline-flex items-center justify-center rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-500 transition-colors shrink-0"
            >
              View services
            </Link>
          </div>
          <div className="p-4 sm:p-6 space-y-5">
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 sm:gap-3">
              {(
                [
                  ["healthy", "Healthy", "emerald"],
                  ["warning", "Warning", "amber"],
                  ["critical", "Critical", "rose"],
                  ["waiting_client", "Waiting on Client", "indigo"],
                  ["paused", "Paused", "slate"],
                ] as const
              ).map(([key, label, tone]) => {
                const n = serviceHealthOverview.counts[key];
                const ring =
                  tone === "emerald"
                    ? "ring-emerald-200/80 bg-emerald-50/90"
                    : tone === "amber"
                      ? "ring-amber-200/80 bg-amber-50/90"
                      : tone === "rose"
                        ? "ring-rose-200/80 bg-rose-50/90"
                        : tone === "indigo"
                          ? "ring-indigo-200/80 bg-indigo-50/90"
                          : "ring-slate-200/80 bg-slate-50/90";
                return (
                  <div
                    key={key}
                    className={`rounded-xl border border-white/60 px-3 py-3 sm:py-4 shadow-sm ring-1 ${ring} min-w-0`}
                  >
                    <p className="text-[10px] sm:text-xs font-semibold uppercase tracking-wide text-slate-600 truncate">
                      {label}
                    </p>
                    <p className="mt-1 text-2xl sm:text-3xl font-bold tabular-nums text-[#0F172A]">{n}</p>
                  </div>
                );
              })}
            </div>

            <div className="rounded-xl border border-slate-200 bg-white/80 backdrop-blur-sm p-4 sm:p-5">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
                <h3 className="text-sm font-semibold text-[#0F172A]">Needs attention</h3>
                <p className="text-xs text-slate-500">Warning, Critical, or Waiting on Client</p>
              </div>
              {serviceHealthOverview.attention.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/80 px-4 py-6 text-center">
                  <p className="text-sm font-medium text-slate-700">You&apos;re in good shape</p>
                  <p className="text-xs text-slate-500 mt-1">
                    No services need immediate attention from your side.
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {serviceHealthOverview.attention.map((row) => (
                    <li key={row.id} className="py-3 first:pt-0 last:pb-0">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link
                              href={`/client/services/${row.id}`}
                              className="text-sm font-semibold text-indigo-700 hover:text-indigo-600 hover:underline break-words"
                            >
                              {row.name}
                            </Link>
                            <HealthOverviewBadge health={row.health} />
                          </div>
                          <p className="text-xs text-slate-500 mt-1">
                            Client: <span className="text-slate-700 font-medium">{row.clientName}</span>
                          </p>
                        </div>
                        <div className="text-left sm:text-right shrink-0 min-w-0">
                          <p className="text-xs text-slate-500">Next action</p>
                          <p className="text-sm text-[#0F172A] font-medium break-words">
                            {row.nextAction ?? "—"}
                          </p>
                          <p className="text-[11px] text-slate-500 mt-0.5">
                            Due: <span className="text-slate-700">{row.nextActionDueLabel}</span>
                          </p>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="mt-6 flex flex-wrap gap-3">
        <Link
          href="/client/projects"
          className="inline-flex items-center px-4 py-2 rounded-lg bg-[#4F46E5] text-white font-medium hover:bg-indigo-600 transition-colors"
        >
          View Projects
        </Link>
        <Link
          href="/client/support"
          className="inline-flex items-center px-4 py-2 rounded-lg border border-slate-200 bg-white text-[#0F172A] font-medium hover:bg-slate-50 transition-colors"
        >
          Support Center
        </Link>
        <Link
          href="/client/support?new=1"
          className="inline-flex items-center px-4 py-2 rounded-lg border border-slate-200 bg-white text-[#0F172A] font-medium hover:bg-slate-50 transition-colors"
        >
          ➕ New Ticket
        </Link>
        <Link
          href="/client/invoices"
          className="inline-flex items-center px-4 py-2 rounded-lg border border-slate-200 bg-white text-[#0F172A] font-medium hover:bg-slate-50 transition-colors"
        >
          View Invoices
        </Link>
      </div>

      <div className="mt-8 bg-white rounded-2xl shadow-sm border border-slate-200 p-5 md:p-6 max-w-full">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-[#0F172A] font-semibold">Recent Activity</h2>
          <Link href="/client/services" className="text-sm text-indigo-600 hover:underline">
            View services
          </Link>
        </div>
        <div className="mt-4">
          {recentActivity.length ? (
            <div className="space-y-3">
              {recentActivity.map((item) => (
                <div key={item.id} className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center text-lg">
                    {item.icon}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-[#0F172A] break-words">{item.title}</p>
                      <p className="text-xs text-slate-500 whitespace-nowrap">{item.dateLabel}</p>
                    </div>
                    {item.subtitle ? (
                      <p className="text-xs text-slate-500 mt-1 break-words">{item.subtitle}</p>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-slate-50 border border-slate-100 rounded-xl p-4">
              <p className="text-sm text-slate-700">No recent activity yet.</p>
              <p className="text-xs text-slate-500 mt-1">
                When services, subscriptions, or invoices update, you’ll see it here.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
