"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/authContext";
import { useTenant } from "@/lib/tenantContext";

type Subscription = {
  id: string;
  clientId?: string;
  clientName?: string;
  name?: string;
  price?: number;
  currency?: string;
  interval?: string;
  status?: string;
  startDate?: { toDate: () => Date };
  nextBillingDate?: { toDate: () => Date };
};

export default function ClientSubscriptionsPage() {
  const { user } = useAuth();
  const { tenant, role, clientId } = useTenant();
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user || !tenant?.id || role !== "client" || !clientId) {
      setLoading(false);
      return;
    }

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const q = query(
          collection(db, "tenants", tenant.id, "subscriptions"),
          where("clientId", "==", clientId)
        );
        const snap = await getDocs(q);
        setSubscriptions(
          snap.docs.map((d) => {
            const data = d.data();
            return {
              id: d.id,
              clientId: data.clientId,
              clientName: data.clientName,
              name: data.name,
              price: data.price,
              currency: data.currency,
              interval: data.interval,
              status: data.status,
              startDate: data.startDate,
              nextBillingDate: data.nextBillingDate,
            };
          })
        );
      } catch {
        setError("Unable to load subscriptions. Please try again.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [user, tenant?.id, role, clientId]);

  function StatusBadge({ status }: { status?: string }) {
    const s = status ?? "";
    const styles =
      s === "active"
        ? "bg-green-100 text-green-700"
        : s === "paused"
          ? "bg-yellow-100 text-yellow-700"
          : "bg-slate-200 text-slate-600";
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${styles}`}>
        {status ?? "—"}
      </span>
    );
  }

  function formatDate(ts?: { toDate: () => Date }) {
    if (!ts) return "—";
    return ts.toDate().toLocaleDateString();
  }

  if (!user) return <p className="text-[#0F172A]">Please log in</p>;
  if (!tenant) return <p className="text-[#0F172A]">Loading tenant…</p>;
  if (role !== "client" || !clientId) return <p className="text-[#0F172A]">Access denied.</p>;
  if (loading) return <p className="text-[#0F172A]">Loading subscriptions…</p>;
  if (error) return (
    <div>
      <h1 className="text-[#0F172A] text-2xl font-semibold">Subscriptions</h1>
      <div className="mt-6 bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <p className="text-red-600">{error}</p>
      </div>
    </div>
  );

  return (
    <div>
      <h1 className="text-[#0F172A] text-2xl font-semibold">Subscriptions</h1>
      <Link href="/client/dashboard" className="inline-block mt-2 text-[#4F46E5] hover:underline text-sm">
        ← Back to dashboard
      </Link>

      {subscriptions.length === 0 ? (
        <div className="mt-6 bg-white rounded-xl shadow-sm border border-slate-200 p-12 text-center">
          <p className="text-slate-500 text-lg">No subscriptions yet</p>
          <p className="text-slate-400 text-sm mt-1">Your subscriptions will appear here when they are assigned.</p>
        </div>
      ) : (
        <div className="mt-6 bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="text-left py-3 px-4 text-sm font-medium text-[#0F172A]">Name</th>
                <th className="text-right py-3 px-4 text-sm font-medium text-[#0F172A]">Price</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-[#0F172A]">Interval</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-[#0F172A]">Next Billing</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-[#0F172A]">Status</th>
              </tr>
            </thead>
            <tbody>
              {subscriptions.map((sub) => (
                <tr key={sub.id} className="border-b border-slate-100 last:border-0">
                  <td className="py-3 px-4 text-[#0F172A]">{sub.name ?? "—"}</td>
                  <td className="py-3 px-4 text-right text-[#0F172A]">
                    {sub.price != null
                      ? `${sub.currency ?? "USD"} ${sub.price.toLocaleString()}`
                      : "—"}
                  </td>
                  <td className="py-3 px-4 text-[#0F172A] capitalize">{sub.interval ?? "—"}</td>
                  <td className="py-3 px-4 text-[#0F172A]">{formatDate(sub.nextBillingDate)}</td>
                  <td className="py-3 px-4">
                    <StatusBadge status={sub.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
