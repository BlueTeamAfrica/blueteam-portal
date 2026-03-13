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
  type: "invoice" | "project" | "subscription";
  title: string;
  subtitle?: string;
  dateLabel: string;
  icon: string;
};

export default function PortalPage() {
  const { user } = useAuth();
  const { tenant } = useTenant();
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

        // Recent activity: mix of latest invoices, subscriptions, projects
        const [recentInvoicesSnap, recentSubsSnap, recentProjectsSnap] = await Promise.all([
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
              orderBy("createdAt", "desc"),
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
        ]);

        const activity: RecentActivityItem[] = [];

        recentInvoicesSnap.forEach((doc) => {
          const data = doc.data() as {
            invoiceNumber?: string;
            clientName?: string;
            createdAt?: { toDate?: () => Date };
            amount?: number;
            currency?: string;
            status?: string;
          };
          const createdAt =
            data.createdAt && typeof data.createdAt.toDate === "function"
              ? data.createdAt.toDate()
              : undefined;
          activity.push({
            id: doc.id,
            type: "invoice",
            title: data.invoiceNumber ?? doc.id,
            subtitle: data.clientName
              ? `${data.clientName}${
                  typeof data.amount === "number"
                    ? ` · ${(data.currency ?? "USD")} ${data.amount.toLocaleString()}`
                    : ""
                }`
              : undefined,
            dateLabel: createdAt ? createdAt.toLocaleDateString() : "—",
            icon: "💸",
          });
        });

        recentSubsSnap.forEach((doc) => {
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
            type: "subscription",
            title: data.name ?? "Subscription",
            subtitle: data.clientName,
            dateLabel: createdAt ? createdAt.toLocaleDateString() : "—",
            icon: "🔁",
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
            title: data.name ?? "Project",
            subtitle: data.clientName,
            dateLabel: createdAt ? createdAt.toLocaleDateString() : "—",
            icon: "📁",
          });
        });

        // Sort mixed activity by recency (best-effort, using dateLabel when available)
        const sortedActivity = activity.slice(0, 12);

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
  if (!tenant) return <p className="text-[#0F172A]">Loading tenant…</p>;

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
