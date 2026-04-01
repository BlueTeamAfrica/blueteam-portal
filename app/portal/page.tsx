"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  collection,
  getDocs,
  query,
  where,
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
  healthPreviewPriority,
  isAttentionServiceHealth,
  normalizeServiceHealth,
} from "@/lib/serviceHealth";
import { getManagedServiceCategoryLabel, getManagedServiceDisplayName } from "@/lib/serviceDisplayName";

type Kpis = {
  totalClients: number;
  totalProjects: number;
  activeProjects: number;
  activeSubscriptions: number;
  unpaidInvoices: number;
  unpaidInvoiceValue: number;
};

type RecentActivityItem = {
  id: string;
  type: "invoice" | "project" | "subscription" | "service";
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

type ServicePreviewRow = {
  id: string;
  name: string;
  categoryLabel: string;
  clientName: string;
  health: string;
  healthNote?: string;
  nextAction?: string;
  nextActionDueLabel: string;
};

type UnpaidInvoicePreviewRow = {
  id: string;
  label: string;
  amount: number;
  currency: string;
  dueDateLabel: string;
};

type ServiceHealthOverview = {
  counts: {
    healthy: number;
    warning: number;
    critical: number;
    waiting_client: number;
    paused: number;
  };
  preview: ServicePreviewRow[];
  hasAnyAttention: boolean;
  totalServices: number;
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

export default function PortalPage() {
  const { user } = useAuth();
  const { tenant, loading: tenantLoading, error: tenantError } = useTenant();
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [unpaidInvoicePreview, setUnpaidInvoicePreview] = useState<UnpaidInvoicePreviewRow[]>([]);
  const [recentActivity, setRecentActivity] = useState<RecentActivityItem[]>([]);
  const [serviceHealthOverview, setServiceHealthOverview] = useState<ServiceHealthOverview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const tenantId = tenant?.id;
    if (!user || !tenantId) {
      setLoading(false);
      return;
    }

    async function loadDashboard() {
      setLoading(true);
      try {
        // Clients
        const clientsSnap = await getDocs(collection(db, "tenants", tenantId as string, "clients"));
        const totalClients = clientsSnap.size;

        // Projects (total + active)
        const projectsSnap = await getDocs(collection(db, "tenants", tenantId as string, "projects"));
        const totalProjects = projectsSnap.size;
        let activeProjects = 0;
        projectsSnap.forEach((doc) => {
          const data = doc.data() as { status?: string };
          if ((data.status ?? "").toLowerCase() === "active") activeProjects += 1;
        });

        // Active subscriptions
        const activeSubsSnap = await getDocs(
          query(
            collection(db, "tenants", tenantId as string, "subscriptions"),
            where("status", "==", "active")
          )
        );
        const activeSubscriptions = activeSubsSnap.size;

        // Unpaid invoices (count + value) + sample for recent activity
        const unpaidQuery = query(
          collection(db, "tenants", tenantId as string, "invoices"),
          where("status", "==", "unpaid")
        );
        const unpaidSnap = await getDocs(unpaidQuery);

        let unpaidInvoices = 0;
        let unpaidInvoiceValue = 0;
        const unpaidSample: UnpaidInvoicePreviewRow[] = [];
        unpaidSnap.forEach((doc) => {
          unpaidInvoices += 1;
          const data = doc.data() as {
            amount?: number;
            currency?: string;
            invoiceNumber?: string;
            clientName?: string;
            dueDate?: { toDate?: () => Date };
            createdAt?: { toDate?: () => Date };
          };
          const amount = typeof data.amount === "number" ? data.amount : 0;
          unpaidInvoiceValue += amount;
          if (unpaidSample.length < 5) {
            const label = data.invoiceNumber ?? doc.id;
            const dueDate =
              data.dueDate && typeof data.dueDate.toDate === "function"
                ? data.dueDate.toDate()
                : undefined;
            unpaidSample.push({
              id: doc.id,
              label,
              amount,
              currency: (data.currency ?? "USD").toUpperCase(),
              dueDateLabel: dueDate ? dueDate.toLocaleDateString(undefined, { dateStyle: "medium" }) : "—",
            });
          }
        });

        // Recent activity: mix of latest invoices, subscriptions, projects, services
        const [recentInvoicesSnap, recentSubsSnap, recentProjectsSnap, recentServicesSnap] = await Promise.all([
          getDocs(
            query(
              collection(db, "tenants", tenantId as string, "invoices"),
              orderBy("createdAt", "desc"),
              limit(5)
            )
          ),
          getDocs(
            query(
              collection(db, "tenants", tenantId as string, "subscriptions"),
              orderBy("updatedAt", "desc"),
              limit(5)
            )
          ),
          getDocs(
            query(
              collection(db, "tenants", tenantId as string, "projects"),
              orderBy("createdAt", "desc"),
              limit(5)
            )
          ),
          getDocs(
            query(
              collection(db, "tenants", tenantId as string, "services"),
              orderBy("updatedAt", "desc"),
              limit(8)
            )
          ),
        ]);

        const activity: RecentActivityItem[] = [];

        // Build a lightweight subscriptionId -> service mapping for better labels
        const serviceBySubId = new Map<string, { serviceName: string; billingType?: string }>();
        recentServicesSnap.forEach((doc) => {
          const data = doc.data() as {
            name?: string;
            category?: string;
            categoryLabel?: string;
            subscriptionId?: string;
            billingType?: string;
          };
          if (!data.subscriptionId) return;
          serviceBySubId.set(data.subscriptionId, {
            serviceName: getManagedServiceDisplayName({
              name: data.name,
              category: data.category,
              categoryLabel: data.categoryLabel,
            }),
            billingType: data.billingType,
          });
        });

        recentInvoicesSnap.forEach((doc) => {
          const data = doc.data() as {
            invoiceNumber?: string;
            clientName?: string;
            createdAt?: { toDate?: () => Date };
            amount?: number;
            currency?: string;
            status?: string;
            subscriptionId?: string;
          };
          const createdAt =
            data.createdAt && typeof data.createdAt.toDate === "function"
              ? data.createdAt.toDate()
              : undefined;
          const service = data.subscriptionId ? serviceBySubId.get(data.subscriptionId) : undefined;
          activity.push({
            id: doc.id,
            type: "invoice",
            title: service
              ? `Invoice generated for service "${service.serviceName}"`
              : data.invoiceNumber
                ? `Invoice ${data.invoiceNumber} generated`
                : "Invoice generated",
            subtitle: data.clientName
              ? `${data.clientName}${
                  typeof data.amount === "number"
                    ? ` · ${(data.currency ?? "USD")} ${data.amount.toLocaleString()}`
                    : ""
                }`
              : undefined,
            dateLabel: createdAt
              ? createdAt.toLocaleDateString(undefined, { month: "short", day: "numeric" })
              : "—",
            icon: "💸",
            timestamp: createdAt,
          });
        });

        recentSubsSnap.forEach((doc) => {
          const data = doc.data() as {
            name?: string;
            clientName?: string;
            createdAt?: { toDate?: () => Date };
            updatedAt?: { toDate?: () => Date };
            status?: string;
          };
          const updatedAt =
            data.updatedAt && typeof data.updatedAt.toDate === "function"
              ? data.updatedAt.toDate()
              : data.createdAt && typeof data.createdAt.toDate === "function"
                ? data.createdAt.toDate()
                : undefined;
          const service = serviceBySubId.get(doc.id);
          const status = (data.status ?? "").toLowerCase();
          activity.push({
            id: doc.id,
            type: "subscription",
            title: service
              ? status === "paused"
                ? `Subscription paused for service "${service.serviceName}"`
                : `Subscription updated for service "${service.serviceName}"`
              : data.name
                ? `Subscription "${data.name}" updated`
                : "Subscription updated",
            subtitle: data.clientName ?? undefined,
            dateLabel: updatedAt
              ? updatedAt.toLocaleDateString(undefined, { month: "short", day: "numeric" })
              : "—",
            icon: "🔁",
            timestamp: updatedAt,
          });
        });

        recentProjectsSnap.forEach((doc) => {
          const data = doc.data() as {
            name?: string;
            clientName?: string;
            createdAt?: { toDate?: () => Date };
            status?: string;
          };
          const createdAt =
            data.createdAt && typeof data.createdAt.toDate === "function"
              ? data.createdAt.toDate()
              : undefined;
          activity.push({
            id: doc.id,
            type: "project",
            title: data.name ? `Project "${data.name}" created` : "Project created",
            subtitle: data.clientName ? `Client: ${data.clientName}` : undefined,
            dateLabel: createdAt
              ? createdAt.toLocaleDateString(undefined, { month: "short", day: "numeric" })
              : "—",
            icon: "📁",
            timestamp: createdAt,
          });
        });

        recentServicesSnap.forEach((doc) => {
          const data = doc.data() as {
            name?: string;
            category?: string;
            categoryLabel?: string;
            clientName?: string;
            createdAt?: { toDate?: () => Date };
            updatedAt?: { toDate?: () => Date };
            billingType?: string;
            subscriptionId?: string;
          };
          const svcTitle = getManagedServiceDisplayName({
            name: data.name,
            category: data.category,
            categoryLabel: data.categoryLabel,
          });
          const createdAt =
            data.createdAt && typeof data.createdAt.toDate === "function"
              ? data.createdAt.toDate()
              : undefined;
          const updatedAt =
            data.updatedAt && typeof data.updatedAt.toDate === "function"
              ? data.updatedAt.toDate()
              : createdAt;

          // Core events (lightweight, based on available fields)
          if (createdAt) {
            activity.push({
              id: `${doc.id}_created`,
              type: "service",
              title: `Service created: ${svcTitle}`,
              subtitle: data.clientName ? `Client: ${data.clientName}` : undefined,
              dateLabel: createdAt.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
              icon: "🛠️",
              timestamp: createdAt,
            });
          }

          if (updatedAt && createdAt && updatedAt.getTime() - createdAt.getTime() > 2 * 60 * 1000) {
            activity.push({
              id: `${doc.id}_updated`,
              type: "service",
              title: `Service updated: ${svcTitle}`,
              subtitle: data.clientName ? `Client: ${data.clientName}` : undefined,
              dateLabel: updatedAt.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
              icon: "🧾",
              timestamp: updatedAt,
            });
          }

          const bt = (data.billingType ?? "").toLowerCase();
          if (updatedAt && bt === "recurring") {
            activity.push({
              id: `${doc.id}_recurring`,
              type: "service",
              title: `Recurring billing: ${svcTitle}`,
              subtitle: data.clientName ? `Client: ${data.clientName}` : undefined,
              dateLabel: updatedAt.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
              icon: "💳",
              timestamp: updatedAt,
            });
          }

          if (updatedAt && data.subscriptionId && bt === "recurring") {
            activity.push({
              id: `${doc.id}_sub_linked`,
              type: "service",
              title: `Subscription linked: ${svcTitle}`,
              subtitle: data.clientName ? `Client: ${data.clientName}` : undefined,
              dateLabel: updatedAt.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
              icon: "🔗",
              timestamp: updatedAt,
            });
          }
        });

        // Sort mixed activity by recency and limit
        const sortedActivity = activity
          .slice()
          .sort((a, b) => {
            const at = a.timestamp ? a.timestamp.getTime() : 0;
            const bt = b.timestamp ? b.timestamp.getTime() : 0;
            return bt - at;
          })
          .slice(0, 15);

        const servicesSnap = await getDocs(collection(db, "tenants", tenantId as string, "services"));
        const counts = {
          healthy: 0,
          warning: 0,
          critical: 0,
          waiting_client: 0,
          paused: 0,
        };
        type RowSort = ServicePreviewRow & { _due: number; _prio: number };
        const sortRows: RowSort[] = [];

        servicesSnap.forEach((d) => {
          const data = d.data() as {
            name?: string;
            category?: string;
            categoryLabel?: string;
            clientName?: string;
            health?: string;
            healthNote?: string;
            nextAction?: string;
            nextActionDue?: Timestamp | null;
          };
          const bucket = bucketServiceHealthForCounts(data.health);
          counts[bucket] += 1;

          let dueMs = Infinity;
          const due = data.nextActionDue;
          if (due && typeof due.toDate === "function") {
            try {
              dueMs = due.toDate().getTime();
            } catch {
              dueMs = Infinity;
            }
          }

          const categoryLabel = getManagedServiceCategoryLabel(data.category, data.categoryLabel);
          sortRows.push({
            id: d.id,
            name: getManagedServiceDisplayName({
              name: data.name,
              category: data.category,
              categoryLabel: data.categoryLabel,
            }),
            categoryLabel,
            clientName: data.clientName?.trim() ? data.clientName.trim() : "—",
            health: data.health ?? "",
            healthNote: data.healthNote?.trim() ? data.healthNote.trim() : undefined,
            nextAction: data.nextAction?.trim() ? data.nextAction.trim() : undefined,
            nextActionDueLabel: formatServiceDue(data.nextActionDue ?? null),
            _due: dueMs,
            _prio: healthPreviewPriority(data.health),
          });
        });

        const hasAnyAttention = sortRows.some((r) => isAttentionServiceHealth(r.health));

        sortRows.sort((a, b) => {
          if (b._prio !== a._prio) return b._prio - a._prio;
          if (a._due !== b._due) return a._due - b._due;
          return a.name.localeCompare(b.name);
        });

        const previewLimit = hasAnyAttention ? 5 : 3;
        const preview: ServicePreviewRow[] = sortRows.slice(0, previewLimit).map(({ _due, _prio, ...rest }) => rest);

        setKpis({
          totalClients,
          totalProjects,
          activeProjects,
          activeSubscriptions,
          unpaidInvoices,
          unpaidInvoiceValue,
        });
        setUnpaidInvoicePreview(unpaidSample);
        setRecentActivity(sortedActivity);
        setServiceHealthOverview({
          counts,
          preview,
          hasAnyAttention,
          totalServices: sortRows.length,
        });
      } finally {
        setLoading(false);
      }
    }

    loadDashboard();
  }, [user, tenant?.id]);

  if (!user) return <p className="text-[#0F172A]">Please log in</p>;
  if (tenantLoading) return <p className="text-[#0F172A]">Loading tenant…</p>;
  if (tenantError) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <h1 className="text-[#0F172A] text-xl sm:text-2xl font-semibold">Dashboard</h1>
        <p className="text-rose-700 mt-2 text-sm break-words">
          Unable to load tenant context: {tenantError}
        </p>
        <p className="text-slate-500 mt-2 text-sm">
          Check Firestore permissions for users/&lt;uid&gt;, tenants/&lt;tenantId&gt;, and userTenants/&lt;uid&gt;_&lt;tenantId&gt;.
        </p>
      </div>
    );
  }
  if (!tenant) return <p className="text-[#0F172A]">No tenant access.</p>;

  return (
    <div className="max-w-full min-w-0 space-y-5 md:space-y-7">
      {/* Welcome / header */}
      <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 md:p-5 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1 min-w-0">
          <h1 className="text-[#0F172A] text-xl sm:text-2xl font-semibold break-words tracking-tight">
            Welcome back{tenant.name ? `, ${tenant.name}` : ""}.
          </h1>
          <p className="text-sm text-slate-600 break-words leading-snug">
            Revenue, delivery, and support — one calm overview.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 md:justify-end">
          <Link
            href="/portal/invoices"
            className="inline-flex items-center justify-center px-3 py-2 sm:px-4 rounded-lg bg-[#4F46E5] text-white text-sm font-semibold hover:bg-indigo-600 transition-colors whitespace-nowrap shadow-sm"
          >
            Create invoice
          </Link>
          <Link
            href="/portal/support?new=1"
            className="inline-flex items-center justify-center px-3 py-2 sm:px-4 rounded-lg border border-slate-200 bg-white text-sm font-medium text-[#0F172A] hover:bg-slate-50 whitespace-nowrap"
          >
            New ticket
          </Link>
          <Link
            href="/portal/support"
            className="inline-flex items-center justify-center px-3 py-2 sm:px-4 rounded-lg border border-slate-200 bg-white text-sm font-medium text-[#0F172A] hover:bg-slate-50 whitespace-nowrap"
          >
            Support
          </Link>
          <Link
            href="/portal/subscriptions"
            className="hidden sm:inline-flex items-center justify-center px-3 py-2 sm:px-4 rounded-lg border border-slate-200 bg-white text-sm font-medium text-[#0F172A] hover:bg-slate-50 whitespace-nowrap"
          >
            Subscriptions
          </Link>
          <Link
            href="/portal/clients"
            className="hidden sm:inline-flex items-center justify-center px-3 py-2 sm:px-4 rounded-lg border border-slate-200 bg-white text-sm font-medium text-[#0F172A] hover:bg-slate-50 whitespace-nowrap"
          >
            Clients
          </Link>
        </div>
      </section>

      {/* Service overview / KPIs */}
      <section>
        {loading && !kpis && <p className="text-[#0F172A]">Loading dashboard…</p>}
        {!loading && kpis && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 md:p-5 max-w-full">
              <div className="text-xs uppercase tracking-wide text-slate-500">Total Clients</div>
              <div className="text-2xl font-semibold text-[#0F172A] mt-1">{kpis.totalClients}</div>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 md:p-5 max-w-full">
              <div className="text-xs uppercase tracking-wide text-slate-500">Active Projects</div>
              <div className="text-2xl font-semibold text-[#0F172A] mt-1">
                {kpis.activeProjects}/{kpis.totalProjects}
              </div>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 md:p-5 max-w-full">
              <div className="text-xs uppercase tracking-wide text-slate-500">Active Subscriptions</div>
              <div className="text-2xl font-semibold text-[#0F172A] mt-1">
                {kpis.activeSubscriptions}
              </div>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 md:p-5 max-w-full">
              <div className="text-xs uppercase tracking-wide text-red-600">Unpaid Invoices</div>
              <div className="text-2xl font-semibold text-[#0F172A] mt-1">
                {kpis.unpaidInvoices}
              </div>
              <p className="text-sm text-slate-500 mt-1">
                Value: ${kpis.unpaidInvoiceValue.toLocaleString()}
              </p>
            </div>
          </div>
        )}
      </section>

      {/* Service Health Overview — operational layer */}
      {kpis && serviceHealthOverview && (
        <section className="rounded-2xl border border-slate-200/80 bg-gradient-to-br from-slate-50 via-white to-indigo-50/40 shadow-sm overflow-hidden max-w-full">
          <div className="px-4 py-3 sm:px-5 sm:py-3.5 border-b border-slate-200/80 bg-slate-900/[0.04] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <h2 className="text-[#0F172A] text-lg font-semibold tracking-tight">Service health</h2>
              <p className="text-xs text-slate-600 mt-0.5 max-w-xl leading-relaxed">
                What needs attention across managed services. New services default to{" "}
                <span className="font-medium text-slate-700">Healthy</span> until you set otherwise — open a row to
                update notes and next actions.
              </p>
            </div>
            <Link
              href="/portal/services"
              className="inline-flex items-center justify-center rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-500 transition-colors shrink-0"
            >
              Open Services
            </Link>
          </div>

          <div className="p-4 sm:p-5 space-y-4">
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

            <div className="rounded-xl border border-slate-200 bg-white/90 backdrop-blur-sm p-4 sm:p-4 shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mb-3">
                <div>
                  <h3 className="text-sm font-semibold text-[#0F172A]">Priority services</h3>
                  <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                    {serviceHealthOverview.hasAnyAttention
                      ? "Sorted by severity, then next action date. Jump in to log notes or clear blockers."
                      : "Nothing urgent — sample of active services. Open any row to refine health or next steps."}
                  </p>
                </div>
                <Link
                  href="/portal/services"
                  className="text-xs font-semibold text-indigo-600 hover:text-indigo-500 shrink-0"
                >
                  All services →
                </Link>
              </div>

              {serviceHealthOverview.totalServices === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/90 px-4 py-4 text-center">
                  <p className="text-sm font-medium text-slate-700">No services yet</p>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                    Add managed services to track health, client linkage, and billing in one place.
                  </p>
                  <Link
                    href="/portal/services"
                    className="inline-block mt-3 text-xs font-semibold text-indigo-600 hover:underline"
                  >
                    Go to Services
                  </Link>
                </div>
              ) : serviceHealthOverview.preview.length === 0 ? (
                <p className="text-sm text-slate-500">No preview rows to show.</p>
              ) : (
                <ul className="divide-y divide-slate-100 border border-slate-100 rounded-lg overflow-hidden bg-white">
                  {serviceHealthOverview.preview.map((row) => (
                    <li key={row.id} className="px-3 py-2.5 sm:px-4 sm:py-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link
                              href={`/portal/services/${row.id}`}
                              className="text-sm font-semibold text-[#0F172A] hover:text-indigo-700 break-words"
                            >
                              {row.name}
                            </Link>
                            <HealthOverviewBadge health={row.health} />
                          </div>
                          {row.categoryLabel ? (
                            <p className="text-[11px] text-slate-500">{row.categoryLabel}</p>
                          ) : null}
                          <p className="text-[11px] text-slate-500">
                            Client: <span className="text-slate-700 font-medium">{row.clientName}</span>
                          </p>
                          {row.healthNote ? (
                            <p className="text-[11px] text-slate-600 italic leading-snug break-words">
                              {row.healthNote}
                            </p>
                          ) : null}
                        </div>
                        <div className="flex flex-col sm:items-end gap-2 shrink-0 min-w-0 sm:max-w-[45%]">
                          {(row.nextAction || row.nextActionDueLabel !== "—") && (
                            <div className="text-left sm:text-right min-w-0 w-full">
                              {row.nextAction ? (
                                <>
                                  <p className="text-[10px] uppercase tracking-wide text-slate-500">Next action</p>
                                  <p className="text-xs font-medium text-[#0F172A] break-words">{row.nextAction}</p>
                                </>
                              ) : null}
                              {row.nextActionDueLabel !== "—" ? (
                                <p className="text-[11px] text-slate-500 mt-1">
                                  Due{" "}
                                  <span className="font-medium text-slate-700">{row.nextActionDueLabel}</span>
                                </p>
                              ) : null}
                            </div>
                          )}
                          <Link
                            href={`/portal/services/${row.id}`}
                            className="inline-flex items-center justify-center rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 sm:w-auto w-full text-center"
                          >
                            Review & update
                          </Link>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {!serviceHealthOverview.hasAnyAttention && serviceHealthOverview.totalServices > 0 ? (
                <div className="mt-3 rounded-lg border border-emerald-200/80 bg-emerald-50/90 px-3 py-2.5 sm:px-4 sm:py-3">
                  <p className="text-sm font-semibold text-emerald-900">All clear on monitored services.</p>
                  <p className="text-xs text-emerald-800/90 mt-0.5 leading-relaxed">
                    No warning, critical, or waiting-on-client states right now.
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        </section>
      )}

      {/* Two-column area: unpaid invoices + activity */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-5">
        {/* Unpaid invoices summary */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 md:p-4 lg:col-span-1 max-w-full">
          <div className="flex items-center justify-between gap-2 mb-2">
            <h2 className="text-[#0F172A] text-base font-semibold">Unpaid invoices</h2>
            <Link
              href="/portal/invoices"
              className="text-xs font-semibold text-indigo-600 hover:text-indigo-500 whitespace-nowrap"
            >
              View all
            </Link>
          </div>
          {kpis && kpis.unpaidInvoices === 0 ? (
            <p className="text-sm text-slate-600 leading-relaxed">Nothing outstanding — great work.</p>
          ) : (
            <>
              <p className="text-sm text-slate-700">
                <span className="font-semibold tabular-nums">{kpis?.unpaidInvoices ?? 0}</span> open ·{" "}
                <span className="font-semibold tabular-nums">${kpis?.unpaidInvoiceValue.toLocaleString() ?? 0}</span>{" "}
                total
              </p>
              {unpaidInvoicePreview.length > 0 ? (
                <ul className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                  {unpaidInvoicePreview.map((row) => (
                    <li
                      key={row.id}
                      className="flex items-start justify-between gap-2 text-sm"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-[#0F172A] truncate">{row.label}</p>
                        <p className="text-xs text-slate-500">Due {row.dueDateLabel}</p>
                      </div>
                      <p className="shrink-0 font-semibold tabular-nums text-[#0F172A]">
                        {row.currency} {row.amount.toLocaleString()}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : null}
              {(kpis?.unpaidInvoices ?? 0) > unpaidInvoicePreview.length ? (
                <p className="text-[11px] text-slate-500 mt-2">
                  +{(kpis?.unpaidInvoices ?? 0) - unpaidInvoicePreview.length} more on Invoices
                </p>
              ) : null}
            </>
          )}
        </div>

        {/* Recent activity timeline */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 md:p-4 lg:col-span-2 max-w-full">
          <div className="flex items-center justify-between gap-2 mb-2">
            <h2 className="text-[#0F172A] text-base font-semibold">Recent activity</h2>
          </div>
          {recentActivity.length === 0 ? (
            <p className="text-sm text-slate-600 leading-relaxed">
              Invoices, subscriptions, projects, and services will appear here as your team works.
            </p>
          ) : (
            <ul className="space-y-2">
              {recentActivity.map((item) => {
                const kind =
                  item.type === "invoice"
                    ? "Invoice"
                    : item.type === "subscription"
                      ? "Subscription"
                      : item.type === "project"
                        ? "Project"
                        : "Service";
                return (
                  <li
                    key={`${item.type}-${item.id}`}
                    className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500 shrink-0">
                        {kind}
                      </span>
                      <span className="text-[11px] text-slate-500 whitespace-nowrap">{item.dateLabel}</span>
                    </div>
                    <p className="text-sm font-medium text-[#0F172A] mt-1 leading-snug break-words">{item.title}</p>
                    {item.subtitle ? (
                      <p className="text-xs text-slate-600 mt-1 leading-relaxed break-words">{item.subtitle}</p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
