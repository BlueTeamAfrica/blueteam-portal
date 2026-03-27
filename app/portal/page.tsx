"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { collection, getDocs, query, where, orderBy, limit } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/authContext";
import { useTenant } from "@/lib/tenantContext";

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

export default function PortalPage() {
  const { user } = useAuth();
  const { tenant, loading: tenantLoading, error: tenantError } = useTenant();
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [recentActivity, setRecentActivity] = useState<RecentActivityItem[]>([]);
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
        const unpaidSample: Array<{ id: string; label: string; amount: number; dueDateLabel: string }> = [];
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
          if (unpaidSample.length < 3) {
            const label = data.invoiceNumber ?? doc.id;
            const dueDate =
              data.dueDate && typeof data.dueDate.toDate === "function"
                ? data.dueDate.toDate()
                : undefined;
            unpaidSample.push({
              id: doc.id,
              label,
              amount,
              dueDateLabel: dueDate ? dueDate.toLocaleDateString() : "—",
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
          const data = doc.data() as { name?: string; subscriptionId?: string; billingType?: string };
          if (!data.subscriptionId) return;
          serviceBySubId.set(data.subscriptionId, {
            serviceName: data.name ?? "Service",
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
            clientName?: string;
            createdAt?: { toDate?: () => Date };
            updatedAt?: { toDate?: () => Date };
            billingType?: string;
            subscriptionId?: string;
          };
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
              title: data.name ? `Service "${data.name}" created` : "Service created",
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
              title: data.name ? `Service "${data.name}" updated` : "Service updated",
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
              title: data.name ? `Service "${data.name}" set to Recurring` : "Service set to Recurring",
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
              title: data.name
                ? `Subscription created for service "${data.name}"`
                : "Subscription created for service",
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

        setKpis({
          totalClients,
          totalProjects,
          activeProjects,
          activeSubscriptions,
          unpaidInvoices,
          unpaidInvoiceValue,
        });
        setRecentActivity(sortedActivity);
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
    <div className="max-w-full min-w-0 space-y-6 md:space-y-8">
      {/* Welcome / header */}
      <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 md:p-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <h1 className="text-[#0F172A] text-xl sm:text-2xl font-semibold break-words">
            Welcome back{tenant.name ? `, ${tenant.name}` : ""}.
          </h1>
          <p className="text-sm text-slate-600 break-words">
            Overview of your clients, projects, invoices, and subscriptions.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/portal/invoices"
            className="px-3 py-2 sm:px-4 rounded-lg bg-[#4F46E5] text-white text-sm font-medium hover:bg-indigo-600 transition-colors whitespace-nowrap"
          >
            ➕ Create Invoice
          </Link>
          <Link
            href="/portal/support"
            className="px-3 py-2 sm:px-4 rounded-lg border border-slate-300 text-sm text-slate-800 font-medium hover:bg-slate-50 whitespace-nowrap"
          >
            Support Center
          </Link>
          <Link
            href="/portal/support?new=1"
            className="px-3 py-2 sm:px-4 rounded-lg border border-slate-300 text-sm text-slate-800 font-medium hover:bg-slate-50 whitespace-nowrap"
          >
            ➕ New Ticket
          </Link>
          <Link
            href="/portal/subscriptions"
            className="px-3 py-2 sm:px-4 rounded-lg border border-slate-300 text-sm text-slate-800 font-medium hover:bg-slate-50 whitespace-nowrap"
          >
            Manage Subscriptions
          </Link>
          <Link
            href="/portal/clients"
            className="px-3 py-2 sm:px-4 rounded-lg border border-slate-300 text-sm text-slate-800 font-medium hover:bg-slate-50 whitespace-nowrap"
          >
            View Clients
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

      {/* Two-column area: unpaid invoices + activity */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
        {/* Unpaid invoices summary */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 md:p-5 lg:col-span-1 max-w-full">
          <div className="flex items-center justify-between gap-2 mb-3">
            <h2 className="text-[#0F172A] text-base font-semibold">Unpaid invoices</h2>
            <Link
              href="/portal/invoices"
              className="text-xs text-[#4F46E5] hover:underline whitespace-nowrap"
            >
              View all
            </Link>
          </div>
          {kpis && kpis.unpaidInvoices === 0 ? (
            <p className="text-sm text-slate-500">You&apos;re all caught up. No unpaid invoices.</p>
          ) : (
            <p className="text-sm text-slate-600">
              {kpis ? kpis.unpaidInvoices : 0} unpaid invoice(s) totalling{" "}
              {kpis ? `$${kpis.unpaidInvoiceValue.toLocaleString()}` : "$0"}.
            </p>
          )}
        </div>

        {/* Recent activity timeline */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 md:p-5 lg:col-span-2 max-w-full">
          <div className="flex items-center justify-between gap-2 mb-3">
            <h2 className="text-[#0F172A] text-base font-semibold">Recent activity</h2>
          </div>
          {recentActivity.length === 0 ? (
            <p className="text-sm text-slate-500">No recent activity yet.</p>
          ) : (
            <ol className="space-y-3 text-sm text-[#0F172A]">
              {recentActivity.map((item) => (
                <li key={`${item.type}-${item.id}`} className="flex items-start gap-3">
                  <div className="mt-0.5">{item.icon}</div>
                  <div className="min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium truncate">{item.title}</p>
                      <span className="text-xs text-slate-500 whitespace-nowrap">
                        {item.dateLabel}
                      </span>
                    </div>
                    {item.subtitle && (
                      <p className="text-xs text-slate-500 truncate">{item.subtitle}</p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>
    </div>
  );
}
