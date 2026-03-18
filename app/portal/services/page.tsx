"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { collection, getDocs, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/authContext";
import { useTenant } from "@/lib/tenantContext";

type ServiceStatus = "active" | "paused" | "pending" | "cancelled" | "retired";

type Service = {
  id: string;
  name?: string;
  clientId?: string;
  clientName?: string;
  projectId?: string;
  projectName?: string;
  category?: string;
  tier?: string;
  status?: ServiceStatus | string;
  renewalDate?: Timestamp;
  updatedAt?: Timestamp;
};

type Client = { id: string; name?: string; email?: string };
type Project = { id: string; name?: string };

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

function CategoryBadge({ category }: { category?: string }) {
  if (!category) return <span className="text-slate-500">—</span>;
  return (
    <span className="inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700 capitalize">
      {category}
    </span>
  );
}

export default function PortalServicesPage() {
  const { user } = useAuth();
  const { tenant } = useTenant();
  const [services, setServices] = useState<Service[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [clientFilter, setClientFilter] = useState<string>("all");

  useEffect(() => {
    const tenantId = tenant?.id;
    if (!user || !tenantId) {
      setLoading(false);
      return;
    }

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [svcSnap, clientsSnap, projectsSnap] = await Promise.all([
          getDocs(collection(db, "tenants", tenantId as string, "services")),
          getDocs(collection(db, "tenants", tenantId as string, "clients")),
          getDocs(collection(db, "tenants", tenantId as string, "projects")),
        ]);

        setClients(
          clientsSnap.docs.map((d) => ({
            id: d.id,
            name: d.data().name,
            email: d.data().email,
          }))
        );
        setProjects(
          projectsSnap.docs.map((d) => ({
            id: d.id,
            name: d.data().name,
          }))
        );
        setServices(
          svcSnap.docs.map((d) => {
            const data = d.data();
            return {
              id: d.id,
              name: data.name,
              clientId: data.clientId,
              clientName: data.clientName,
              projectId: data.projectId,
              projectName: data.projectName,
              category: data.category,
              tier: data.tier ?? data.plan,
              status: data.status,
              renewalDate: data.renewalDate,
              updatedAt: data.updatedAt,
            };
          })
        );
      } catch (e) {
        const err = e as { message?: string };
        setError(err.message ?? "Unable to load services. Please try again.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [user, tenant?.id]);

  const clientLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of clients) map.set(c.id, c.name ?? c.email ?? c.id);
    return map;
  }, [clients]);

  const projectLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of projects) map.set(p.id, p.name ?? p.id);
    return map;
  }, [projects]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const s of services) if (s.category) set.add(String(s.category));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [services]);

  const statuses = useMemo(() => {
    const set = new Set<string>();
    for (const s of services) if (s.status) set.add(String(s.status));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [services]);

  const filtered = useMemo(() => {
    return services.filter((s) => {
      if (statusFilter !== "all" && String(s.status ?? "").toLowerCase() !== statusFilter) return false;
      if (categoryFilter !== "all" && String(s.category ?? "").toLowerCase() !== categoryFilter) return false;
      if (clientFilter !== "all" && (s.clientId ?? "") !== clientFilter) return false;
      return true;
    });
  }, [services, statusFilter, categoryFilter, clientFilter]);

  if (!user) return <p className="text-[#0F172A]">Please log in</p>;
  if (!tenant) return <p className="text-[#0F172A]">Loading tenant…</p>;
  if (loading) return <p className="text-[#0F172A]">Loading services…</p>;

  return (
    <div className="max-w-full min-w-0">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 md:gap-4">
        <div>
          <h1 className="text-[#0F172A] text-xl sm:text-2xl font-semibold break-words">Services</h1>
          <p className="text-slate-500 text-sm mt-1 break-words">
            Managed services Blueteam actively operates for your clients.
          </p>
        </div>
      </div>

      {error && (
        <div className="mt-4 bg-white rounded-xl shadow-sm border border-rose-200 p-4">
          <p className="text-rose-700 text-sm break-words">{error}</p>
        </div>
      )}

      <div className="mt-4 bg-white rounded-xl shadow-sm border border-slate-200 p-4 md:p-5 max-w-full">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Status</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-[#0F172A] capitalize"
            >
              <option value="all">All</option>
              {statuses.map((s) => (
                <option key={s} value={s.toLowerCase()}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Category</label>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-[#0F172A] capitalize"
            >
              <option value="all">All</option>
              {categories.map((c) => (
                <option key={c} value={c.toLowerCase()}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Client</label>
            <select
              value={clientFilter}
              onChange={(e) => setClientFilter(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-[#0F172A]"
            >
              <option value="all">All</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name ?? c.email ?? c.id}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="mt-4 md:mt-6 bg-white rounded-xl shadow-sm border border-slate-200 p-6 md:p-12 text-center max-w-full">
          <p className="text-slate-500 text-lg">No services yet</p>
          <p className="text-slate-400 text-sm mt-1">
            Add service records under <span className="font-medium">tenants/{tenant.id}/services</span> to surface them here.
          </p>
        </div>
      ) : (
        <div className="mt-4 md:mt-6 bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden max-w-full">
          <div className="w-full overflow-x-auto">
            <table className="min-w-[1050px] w-full border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="text-left py-3 px-4 text-sm font-medium text-[#0F172A]">Service</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-[#0F172A]">Client</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-[#0F172A]">Status</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-[#0F172A]">Category</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-[#0F172A]">Renewal</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-[#0F172A]">Linked Project</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => {
                  const clientLabel = s.clientName ?? (s.clientId ? clientLabelById.get(s.clientId) : undefined) ?? "—";
                  const projectLabel = s.projectName ?? (s.projectId ? projectLabelById.get(s.projectId) : undefined) ?? "—";
                  return (
                    <tr key={s.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50">
                      <td className="py-3 px-4 text-[#0F172A] font-medium">
                        <Link href={`/portal/services/${s.id}`} className="text-indigo-600 hover:underline">
                          {s.name ?? "—"}
                        </Link>
                        {s.tier ? (
                          <div className="text-xs text-slate-500 mt-0.5 break-words">Tier: {s.tier}</div>
                        ) : null}
                      </td>
                      <td className="py-3 px-4 text-[#0F172A]">{clientLabel}</td>
                      <td className="py-3 px-4">
                        <StatusBadge status={s.status} />
                      </td>
                      <td className="py-3 px-4">
                        <CategoryBadge category={s.category} />
                      </td>
                      <td className="py-3 px-4 text-[#0F172A]">{formatDate(s.renewalDate)}</td>
                      <td className="py-3 px-4 text-[#0F172A]">{projectLabel}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

