"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { collection, getDocs, query, where, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/authContext";
import { useTenant } from "@/lib/tenantContext";

type Service = {
  id: string;
  name?: string;
  category?: string;
  tier?: string;
  status?: string;
  renewalDate?: Timestamp;
  projectName?: string;
  projectId?: string;
};

function formatDate(ts?: Timestamp) {
  if (!ts) return "—";
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
        : s === "pending"
          ? "bg-indigo-100 text-indigo-800"
          : s === "cancelled" || s === "retired"
            ? "bg-slate-200 text-slate-700"
            : "bg-slate-100 text-slate-600";
  return (
    <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${styles}`}>
      {status ?? "—"}
    </span>
  );
}

export default function ClientServicesPage() {
  const { user } = useAuth();
  const { tenant, role, clientId } = useTenant();
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
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
          collection(db, "tenants", tenantId as string, "services"),
          where("clientId", "==", clientId)
        );
        const snap = await getDocs(q);
        setServices(
          snap.docs.map((d) => {
            const data = d.data();
            return {
              id: d.id,
              name: data.name,
              category: data.category,
              tier: data.tier ?? data.plan,
              status: data.status,
              renewalDate: data.renewalDate,
              projectId: data.projectId,
              projectName: data.projectName,
            };
          })
        );
      } catch (e) {
        const err = e as { code?: string; message?: string };
        console.log("SERVICES DEBUG: load services failed", { code: err.code, message: err.message });
        setError(err.message ? `Unable to load services: ${err.message}` : "Unable to load services. Please try again.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [user, tenant?.id, role, clientId]);

  const rows = useMemo(() => services, [services]);

  if (!user) return <p className="text-[#0F172A]">Please log in</p>;
  if (!tenant) return <p className="text-[#0F172A]">Loading tenant…</p>;
  if (role !== "client" || !clientId) return <p className="text-[#0F172A]">Access denied.</p>;
  if (loading) return <p className="text-[#0F172A]">Loading services…</p>;

  return (
    <div className="max-w-full min-w-0">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[#0F172A] text-2xl font-semibold">Services</h1>
          <p className="text-slate-500 text-sm mt-1 break-words">
            The managed services Blueteam operates for your account.
          </p>
        </div>
        <Link
          href="/client/dashboard"
          className="shrink-0 inline-flex px-3 py-2 rounded-lg border border-slate-200 bg-white text-[#0F172A] text-sm font-medium hover:bg-slate-50 transition-colors"
        >
          Dashboard
        </Link>
      </div>

      {error && (
        <div className="mt-4 bg-white rounded-xl shadow-sm border border-rose-200 p-4">
          <p className="text-rose-700 text-sm break-words">{error}</p>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="mt-6 bg-white rounded-xl shadow-sm border border-slate-200 p-12 text-center max-w-full">
          <p className="text-slate-500 text-lg">No services yet</p>
          <p className="text-slate-400 text-sm mt-1">
            Your managed services will appear here when they are assigned.
          </p>
        </div>
      ) : (
        <div className="mt-6 bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden max-w-full">
          <div className="w-full overflow-x-auto">
            <table className="min-w-[900px] w-full border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="text-left py-3 px-4 text-sm font-medium text-[#0F172A]">Service</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-[#0F172A]">Status</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-[#0F172A]">Category</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-[#0F172A]">Renewal</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-[#0F172A]">Project</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50">
                    <td className="py-3 px-4 text-[#0F172A] font-medium">
                      <Link href={`/client/services/${s.id}`} className="text-indigo-600 hover:underline">
                        {s.name ?? "—"}
                      </Link>
                      {s.tier ? <div className="text-xs text-slate-500 mt-0.5">Tier: {s.tier}</div> : null}
                    </td>
                    <td className="py-3 px-4">
                      <StatusBadge status={s.status} />
                    </td>
                    <td className="py-3 px-4 text-[#0F172A] capitalize">{s.category ?? "—"}</td>
                    <td className="py-3 px-4 text-[#0F172A]">{formatDate(s.renewalDate)}</td>
                    <td className="py-3 px-4 text-[#0F172A]">{s.projectName ?? s.projectId ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

