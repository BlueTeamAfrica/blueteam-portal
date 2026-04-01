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

function formatDate(ts?: { toDate: () => Date }) {
  if (!ts || typeof ts.toDate !== "function") return "—";
  try {
    return ts.toDate().toLocaleDateString(undefined, { dateStyle: "medium" });
  } catch {
    return "—";
  }
}

function StatusBadge({ status }: { status?: string }) {
  const s = (status ?? "").toLowerCase();
  const styles =
    s === "active"
      ? "bg-emerald-100 text-emerald-800"
      : s === "paused"
        ? "bg-amber-100 text-amber-800"
        : s === "cancelled" || s === "canceled"
          ? "bg-slate-200 text-slate-700"
          : "bg-slate-100 text-slate-600";
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${styles}`}>
      {status ?? "—"}
    </span>
  );
}

function formatAmountInterval(sub: Subscription) {
  if (sub.price == null) return "—";
  const cur = sub.currency ?? "USD";
  let money: string;
  try {
    money = new Intl.NumberFormat(undefined, { style: "currency", currency: cur }).format(sub.price);
  } catch {
    money = `${cur} ${sub.price.toLocaleString()}`;
  }
  const intv = sub.interval ? sub.interval.toLowerCase() : "";
  if (!intv) return money;
  return `${money} / ${intv}`;
}

export default function ClientSubscriptionsPage() {
  const { user } = useAuth();
  const { tenant, role, clientId } = useTenant();
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const tenantId = tenant?.id;
    if (!user || !tenantId || role !== "client" || !clientId) {
      setLoading(false);
      return;
    }

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const q = query(
          collection(db, "tenants", tenantId as string, "subscriptions"),
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

  if (!user) return <p className="text-[#0F172A]">Please log in</p>;
  if (!tenant) return <p className="text-[#0F172A]">Loading tenant…</p>;
  if (role !== "client" || !clientId) return <p className="text-[#0F172A]">Access denied.</p>;
  if (loading) return <p className="text-[#0F172A]">Loading subscriptions…</p>;
  if (error) return (
    <div className="max-w-full min-w-0">
      <h1 className="text-[#0F172A] text-2xl font-semibold">Subscriptions</h1>
      <div className="mt-6 bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <p className="text-red-600">{error}</p>
      </div>
    </div>
  );

  return (
    <div className="max-w-full min-w-0">
      <div>
        <h1 className="text-[#0F172A] text-2xl font-semibold">Subscriptions</h1>
        <Link href="/client/dashboard" className="inline-block mt-2 text-indigo-600 hover:underline text-sm py-1">
          ← Back to dashboard
        </Link>
      </div>

      {subscriptions.length === 0 ? (
        <div className="mt-6 bg-white rounded-xl shadow-sm border border-slate-200 p-8 md:p-12 text-center">
          <p className="text-slate-500 text-lg">No subscriptions yet</p>
          <p className="text-slate-400 text-sm mt-1">Your subscriptions will appear here when they are assigned.</p>
        </div>
      ) : (
        <>
          <ul className="mt-6 md:hidden space-y-3 list-none p-0 m-0">
            {subscriptions.map((sub) => (
              <li
                key={sub.id}
                className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm min-w-0"
              >
                <div className="flex items-start justify-between gap-3 min-w-0">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Subscription</p>
                    <p className="text-lg font-semibold text-[#0F172A] break-words">{sub.name ?? "—"}</p>
                    <p className="mt-2 text-base font-semibold text-[#0F172A] tabular-nums">{formatAmountInterval(sub)}</p>
                  </div>
                  <StatusBadge status={sub.status} />
                </div>
                <dl className="mt-4 space-y-2 text-sm border-t border-slate-100 pt-4">
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500 shrink-0">Next billing</dt>
                    <dd className="font-medium text-[#0F172A] text-right">{formatDate(sub.nextBillingDate)}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>

          <div className="mt-6 hidden md:block bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden max-w-full">
            <div className="w-full overflow-x-auto">
              <table className="min-w-[720px] w-full border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="text-left py-3 px-4 text-sm font-medium text-[#0F172A]">Name</th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-[#0F172A]">Price</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-[#0F172A]">Interval</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-[#0F172A]">Next billing</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-[#0F172A]">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {subscriptions.map((sub) => (
                    <tr key={sub.id} className="border-b border-slate-100 last:border-0">
                      <td className="py-3 px-4 text-[#0F172A] font-medium">{sub.name ?? "—"}</td>
                      <td className="py-3 px-4 text-right text-[#0F172A] tabular-nums">
                        {sub.price != null
                          ? (() => {
                              const cur = sub.currency ?? "USD";
                              try {
                                return new Intl.NumberFormat(undefined, { style: "currency", currency: cur }).format(sub.price);
                              } catch {
                                return `${cur} ${sub.price.toLocaleString()}`;
                              }
                            })()
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
          </div>
        </>
      )}
    </div>
  );
}
