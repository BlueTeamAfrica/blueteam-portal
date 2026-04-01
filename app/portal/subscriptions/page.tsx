"use client";

import { useEffect, useState } from "react";
import {
  collection,
  getDocs,
  addDoc,
  doc,
  updateDoc,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

type SubStatus = "active" | "paused" | "cancelled";

async function updateSubscriptionStatus(
  tenantId: string,
  subscriptionId: string,
  status: SubStatus
) {
  const ref = doc(db, "tenants", tenantId, "subscriptions", subscriptionId);
  await updateDoc(ref, { status });
}
import { useAuth } from "@/lib/authContext";
import { useTenant } from "@/lib/tenantContext";
import { PORTAL_SELECT_CLASS, PORTAL_SELECT_LABEL_CLASS } from "@/lib/portalSelectStyles";
import { SelectArrowWrap } from "@/components/portal/SelectArrowWrap";

type Client = { id: string; name?: string; email?: string; status?: string };
type Subscription = {
  id: string;
  clientId?: string;
  clientName?: string;
  name?: string;
  price?: number;
  currency?: string;
  interval?: string;
  status?: string;
  startDate?: Timestamp;
  nextBillingDate?: Timestamp;
  createdAt?: Timestamp;
};

function addMonths(d: Date, months: number): Date {
  const result = new Date(d);
  result.setMonth(result.getMonth() + months);
  return result;
}

function addYears(d: Date, years: number): Date {
  const result = new Date(d);
  result.setFullYear(result.getFullYear() + years);
  return result;
}

function computeNextBillingDate(startDate: Date, interval: string): Date {
  if (interval === "yearly") return addYears(startDate, 1);
  return addMonths(startDate, 1);
}

export default function SubscriptionsPage() {
  const { user } = useAuth();
  const { tenant } = useTenant();
  const [clients, setClients] = useState<Client[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);

  const [showForm, setShowForm] = useState(false);
  const [formClientId, setFormClientId] = useState("");
  const [formName, setFormName] = useState("");
  const [formPrice, setFormPrice] = useState("");
  const [formInterval, setFormInterval] = useState<"monthly" | "yearly">("monthly");
  const [formStartDate, setFormStartDate] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [updatingId, setUpdatingId] = useState<string | null>(null);

  async function loadData() {
    if (!tenant?.id) return;
    setLoading(true);
    try {
      const [clientsSnap, subsSnap] = await Promise.all([
        getDocs(collection(db, "tenants", tenant.id, "clients")),
        getDocs(collection(db, "tenants", tenant.id, "subscriptions")),
      ]);
      setClients(
        clientsSnap.docs.map((d) => ({
          id: d.id,
          name: d.data().name,
          email: d.data().email,
          status: d.data().status,
        }))
      );
      setSubscriptions(
        subsSnap.docs.map((d) => {
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
            createdAt: data.createdAt,
          };
        })
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!user || !tenant?.id) {
      setLoading(false);
      return;
    }
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, tenant?.id]);

  const getClientName = (sub: Subscription) => {
    if (sub.clientName) return sub.clientName;
    if (sub.clientId) {
      const c = clients.find((x) => x.id === sub.clientId);
      return c?.name ?? c?.email ?? sub.clientId;
    }
    return "—";
  };

  async function handleAddSubscription(e: React.FormEvent) {
    e.preventDefault();
    if (!tenant?.id) return;
    if (!formClientId || !formName.trim() || !formPrice || !formStartDate) return;

    const selectedClient = clients.find((c) => c.id === formClientId);
    const clientName = selectedClient?.name ?? selectedClient?.email ?? "";
    const startDate = new Date(formStartDate);
    const nextBillingDate = computeNextBillingDate(startDate, formInterval);

    setSubmitting(true);
    try {
      await addDoc(collection(db, "tenants", tenant.id, "subscriptions"), {
        clientId: formClientId,
        clientName,
        name: formName.trim(),
        price: parseFloat(formPrice),
        currency: "USD",
        interval: formInterval,
        status: "active",
        startDate: Timestamp.fromDate(startDate),
        nextBillingDate: Timestamp.fromDate(nextBillingDate),
        createdAt: serverTimestamp(),
      });

      setFormClientId("");
      setFormName("");
      setFormPrice("");
      setFormInterval("monthly");
      setFormStartDate("");
      setShowForm(false);

      await loadData();
    } finally {
      setSubmitting(false);
    }
  }


  function formatDate(ts?: Timestamp) {
    if (!ts) return "—";
    return ts.toDate().toLocaleDateString();
  }

  if (!user) return <p className="text-[#0F172A]">Please log in</p>;
  if (!tenant) return <p className="text-[#0F172A]">Loading tenant…</p>;
  if (loading) return <p className="text-[#0F172A]">Loading subscriptions…</p>;

  return (
    <div className="max-w-full min-w-0">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 md:gap-4">
        <h1 className="text-[#0F172A] text-xl sm:text-2xl font-semibold break-words">Subscriptions</h1>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="px-3 py-2 sm:px-4 rounded-lg bg-[#4F46E5] text-white text-sm font-medium hover:bg-indigo-600 transition-colors w-fit"
        >
          ➕ Add Subscription
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleAddSubscription}
          className="mt-4 md:mt-6 bg-white rounded-xl shadow-sm border border-slate-200 p-4 md:p-6 space-y-4 max-w-full"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[#0F172A] mb-1">Client *</label>
              <select
                value={formClientId}
                onChange={(e) => setFormClientId(e.target.value)}
                required
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-[#0F172A]"
              >
                <option value="">Select client</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name ?? c.email ?? c.id}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-[#0F172A] mb-1">Name *</label>
              <input
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                required
                placeholder="e.g. Website Hosting"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-[#0F172A] placeholder:text-slate-400"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#0F172A] mb-1">Price *</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={formPrice}
                onChange={(e) => setFormPrice(e.target.value)}
                required
                placeholder="0.00"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-[#0F172A] placeholder:text-slate-400"
              />
            </div>
            <div className="space-y-1">
              <label className={PORTAL_SELECT_LABEL_CLASS}>Interval *</label>
              <SelectArrowWrap>
                <select
                  value={formInterval}
                  onChange={(e) => setFormInterval(e.target.value as "monthly" | "yearly")}
                  className={PORTAL_SELECT_CLASS}
                >
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </SelectArrowWrap>
            </div>
            <div>
              <label className="block text-sm font-medium text-[#0F172A] mb-1">Start Date *</label>
              <input
                type="date"
                value={formStartDate}
                onChange={(e) => setFormStartDate(e.target.value)}
                required
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-[#0F172A]"
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="px-3 py-2 sm:px-4 rounded-lg bg-emerald-600 text-white text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed hover:bg-emerald-700 transition-colors"
            >
              {submitting ? "Creating…" : "Create Subscription"}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-3 py-2 sm:px-4 rounded-lg border border-slate-200 bg-white text-[#0F172A] text-sm font-medium hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {subscriptions.length === 0 ? (
        <div className="mt-4 md:mt-6 bg-white rounded-xl shadow-sm border border-slate-200 p-6 md:p-12 text-center max-w-full">
          <p className="text-slate-500 text-lg">No subscriptions yet</p>
          <p className="text-slate-400 text-sm mt-1">Click {"\"Add Subscription\""} to create your first subscription.</p>
        </div>
      ) : (
        <>
          <div className="mt-4 md:mt-6 md:hidden space-y-3">
            {subscriptions.map((sub) => (
              <div
                key={sub.id}
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-[#0F172A] break-words">{sub.name?.trim() || "Subscription"}</p>
                    <p className="text-sm text-slate-600 mt-0.5">{getClientName(sub)}</p>
                  </div>
                  <span
                    className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-semibold ${
                      sub.status === "active"
                        ? "bg-emerald-100 text-emerald-800"
                        : sub.status === "paused"
                          ? "bg-amber-100 text-amber-800"
                          : "bg-slate-200 text-slate-600"
                    }`}
                  >
                    {sub.status ?? "—"}
                  </span>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <dt className="text-xs text-slate-500">Price</dt>
                    <dd className="font-medium text-[#0F172A]">
                      {sub.price != null ? `${sub.currency ?? "USD"} ${sub.price.toLocaleString()}` : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Interval</dt>
                    <dd className="font-medium text-[#0F172A] capitalize">{sub.interval ?? "—"}</dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-xs text-slate-500">Next billing</dt>
                    <dd className="font-medium text-[#0F172A]">{formatDate(sub.nextBillingDate)}</dd>
                  </div>
                </dl>
                <div className="mt-3 flex flex-wrap gap-2 justify-end">
                  {sub.status === "active" && (
                    <>
                      <button
                        type="button"
                        disabled={updatingId === sub.id}
                        className="px-3 py-2 rounded-lg border border-slate-200 text-sm font-medium text-[#0F172A] hover:bg-slate-50 disabled:opacity-50"
                        onClick={async () => {
                          setUpdatingId(sub.id);
                          try {
                            await updateSubscriptionStatus(tenant!.id, sub.id, "paused");
                            await loadData();
                          } finally {
                            setUpdatingId(null);
                          }
                        }}
                      >
                        {updatingId === sub.id ? "…" : "Pause"}
                      </button>
                      <button
                        type="button"
                        disabled={updatingId === sub.id}
                        className="px-3 py-2 rounded-lg bg-rose-600 text-white text-sm font-semibold hover:bg-rose-700 disabled:opacity-50"
                        onClick={async () => {
                          if (confirm("Cancel this subscription? This cannot be undone.")) {
                            setUpdatingId(sub.id);
                            try {
                              await updateSubscriptionStatus(tenant!.id, sub.id, "cancelled");
                              await loadData();
                            } finally {
                              setUpdatingId(null);
                            }
                          }
                        }}
                      >
                        Cancel
                      </button>
                    </>
                  )}
                  {sub.status === "paused" && (
                    <>
                      <button
                        type="button"
                        disabled={updatingId === sub.id}
                        className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-500 disabled:opacity-50"
                        onClick={async () => {
                          setUpdatingId(sub.id);
                          try {
                            await updateSubscriptionStatus(tenant!.id, sub.id, "active");
                            await loadData();
                          } finally {
                            setUpdatingId(null);
                          }
                        }}
                      >
                        Resume
                      </button>
                      <button
                        type="button"
                        disabled={updatingId === sub.id}
                        className="px-3 py-2 rounded-lg border border-slate-200 text-sm font-medium text-[#0F172A] hover:bg-slate-50 disabled:opacity-50"
                        onClick={async () => {
                          if (confirm("Cancel this subscription? This cannot be undone.")) {
                            setUpdatingId(sub.id);
                            try {
                              await updateSubscriptionStatus(tenant!.id, sub.id, "cancelled");
                              await loadData();
                            } finally {
                              setUpdatingId(null);
                            }
                          }
                        }}
                      >
                        Cancel
                      </button>
                    </>
                  )}
                  {sub.status === "cancelled" && (
                    <span className="text-sm text-slate-500 py-2">Cancelled</span>
                  )}
                </div>
              </div>
            ))}
          </div>

        <div className="mt-4 md:mt-6 hidden md:block bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden max-w-full">
          <div className="w-full overflow-x-auto">
            <table className="min-w-[900px] w-full border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="text-left py-3 px-4 text-sm font-medium text-[#0F172A]">Name</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-[#0F172A]">Client</th>
                <th className="text-right py-3 px-4 text-sm font-medium text-[#0F172A]">Price</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-[#0F172A]">Interval</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-[#0F172A]">Next Billing</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-[#0F172A]">Status</th>
                <th className="text-right py-3 px-4 text-sm font-medium text-[#0F172A]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {subscriptions.map((sub) => (
                <tr key={sub.id} className="border-b border-slate-100 last:border-0">
                  <td className="py-3 px-4 text-[#0F172A]">{sub.name ?? "—"}</td>
                  <td className="py-3 px-4 text-[#0F172A]">{getClientName(sub)}</td>
                  <td className="py-3 px-4 text-right text-[#0F172A]">
                    {sub.price != null
                      ? `${sub.currency ?? "USD"} ${sub.price.toLocaleString()}`
                      : "—"}
                  </td>
                  <td className="py-3 px-4 text-[#0F172A] capitalize">{sub.interval ?? "—"}</td>
                  <td className="py-3 px-4 text-[#0F172A]">{formatDate(sub.nextBillingDate)}</td>
                  <td className="py-3 px-4">
                    <span
                      className={`px-2 py-1 rounded-full text-xs font-medium ${
                        sub.status === "active"
                          ? "bg-green-100 text-green-700"
                          : sub.status === "paused"
                            ? "bg-yellow-100 text-yellow-700"
                            : "bg-slate-200 text-slate-600"
                      }`}
                    >
                      {sub.status ?? "—"}
                    </span>
                  </td>
                  <td className="text-right">
                    <div className="flex justify-end gap-2">
                      {sub.status === "active" && (
                        <>
                          <button
                            type="button"
                            disabled={updatingId === sub.id}
                            className="px-3 py-1.5 rounded-md border border-slate-300 text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                            onClick={async () => {
                              setUpdatingId(sub.id);
                              try {
                                await updateSubscriptionStatus(tenant!.id, sub.id, "paused");
                                await loadData();
                              } finally {
                                setUpdatingId(null);
                              }
                            }}
                          >
                            {updatingId === sub.id ? "Updating…" : "Pause"}
                          </button>
                          <button
                            type="button"
                            disabled={updatingId === sub.id}
                            className="px-3 py-1.5 rounded-md bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                            onClick={async () => {
                              if (confirm("Cancel this subscription? This cannot be undone.")) {
                                setUpdatingId(sub.id);
                                try {
                                  await updateSubscriptionStatus(tenant!.id, sub.id, "cancelled");
                                  await loadData();
                                } finally {
                                  setUpdatingId(null);
                                }
                              }
                            }}
                          >
                            {updatingId === sub.id ? "Updating…" : "Cancel"}
                          </button>
                        </>
                      )}
                      {sub.status === "paused" && (
                        <>
                          <button
                            type="button"
                            disabled={updatingId === sub.id}
                            className="px-3 py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                            onClick={async () => {
                              setUpdatingId(sub.id);
                              try {
                                await updateSubscriptionStatus(tenant!.id, sub.id, "active");
                                await loadData();
                              } finally {
                                setUpdatingId(null);
                              }
                            }}
                          >
                            {updatingId === sub.id ? "Updating…" : "Resume"}
                          </button>
                          <button
                            type="button"
                            disabled={updatingId === sub.id}
                            className="px-3 py-1.5 rounded-md bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                            onClick={async () => {
                              if (confirm("Cancel this subscription? This cannot be undone.")) {
                                setUpdatingId(sub.id);
                                try {
                                  await updateSubscriptionStatus(tenant!.id, sub.id, "cancelled");
                                  await loadData();
                                } finally {
                                  setUpdatingId(null);
                                }
                              }
                            }}
                          >
                            {updatingId === sub.id ? "Updating…" : "Cancel"}
                          </button>
                        </>
                      )}
                      {sub.status === "cancelled" && (
                        <span className="text-sm text-slate-500">Cancelled</span>
                      )}
                    </div>
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
