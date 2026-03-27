"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { collection, getDocs, query, where, doc, getDoc, orderBy, limit } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/authContext";
import { useTenant } from "@/lib/tenantContext";

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

export default function ClientDashboardPage() {
  const { user } = useAuth();
  const { tenant, role, clientId } = useTenant();
  const [clientName, setClientName] = useState<string>("");
  const [activeProjects, setActiveProjects] = useState<number>(0);
  const [unpaidInvoices, setUnpaidInvoices] = useState<number>(0);
  const [totalInvoices, setTotalInvoices] = useState<number>(0);
  const [recentActivity, setRecentActivity] = useState<RecentActivityItem[]>([]);
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
        setClientName((clientDoc.data()?.name as string) ?? "Client");

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
