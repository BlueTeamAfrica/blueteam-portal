"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { addDoc, collection, getDocs, serverTimestamp, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/authContext";
import { useTenant } from "@/lib/tenantContext";
import { MANAGED_SERVICE_CATEGORIES } from "@/lib/managedServiceCategories";

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
  notes?: string;
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
  const normalized = normalizeServiceStatus(status ?? "");
  const styles =
    normalized === "active"
      ? "bg-emerald-100 text-emerald-800"
      : normalized === "paused"
        ? "bg-amber-100 text-amber-800"
        : normalized === "pending"
          ? "bg-indigo-100 text-indigo-800"
          : normalized === "cancelled"
            ? "bg-slate-200 text-slate-700"
            : "bg-slate-100 text-slate-600";

  const label =
    normalized === "pending"
      ? "Pending Setup"
      : normalized === "active"
        ? "Active"
        : normalized === "paused"
          ? "Paused"
          : normalized === "completed"
            ? "Completed"
            : normalized === "cancelled"
              ? "Cancelled"
              : status ?? "—";

  return (
    <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${styles}`}>
      {label}
    </span>
  );
}

function CategoryBadge({ category }: { category?: string }) {
  if (!category) return <span className="text-slate-500">—</span>;

  const normalized = normalizeCategory(category);
  const label = MANAGED_SERVICE_CATEGORIES.find((o) => o.value === normalized)?.label ?? category;
  return (
    <span className="inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700 capitalize">
      {label}
    </span>
  );
}

function normalizeCategory(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[&/]/g, " ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeServiceStatus(input: string) {
  const s = input.trim().toLowerCase();
  if (!s) return "";
  if (s === "active") return "active";
  if (s === "paused" || s === "on-hold" || s === "on hold") return "paused";
  if (s === "pending" || s === "in_progress" || s === "in progress" || s === "open") return "pending";
  if (s === "completed" || s === "complete") return "completed";
  if (s === "cancelled" || s === "canceled") return "cancelled";
  if (s === "retired") return "cancelled";
  return s;
}

export default function PortalServicesPage() {
  const router = useRouter();
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

  const [showCreate, setShowCreate] = useState(false);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const [formClientId, setFormClientId] = useState<string>("");
  const [formCategory, setFormCategory] = useState<string>(MANAGED_SERVICE_CATEGORIES[0]?.value ?? "");
  const [formStatus, setFormStatus] = useState<string>("active");
  const [formProjectId, setFormProjectId] = useState<string>("");
  const [formStartDate, setFormStartDate] = useState<string>(todayIso);
  const [formRenewalDate, setFormRenewalDate] = useState<string>("");
  const [formNotes, setFormNotes] = useState<string>("");

  async function loadAll() {
    const tenantId = tenant?.id;
    if (!user || !tenantId) {
      setLoading(false);
      return;
    }

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
            notes: data.notes,
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

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, tenant?.id]);

  useEffect(() => {
    if (!showCreate) return;
    // Initialize sensible defaults only when opening the modal.
    setCreateError(null);
    setFormRenewalDate((v) => v);
    setFormNotes((v) => v);

    if (!formClientId && clients.length > 0) setFormClientId(clients[0].id);
    if (!formStartDate) setFormStartDate(todayIso);
    if (!formProjectId) setFormProjectId("");
    if (!formCategory && MANAGED_SERVICE_CATEGORIES[0]?.value) setFormCategory(MANAGED_SERVICE_CATEGORIES[0].value);
  }, [showCreate]); // intentionally not depending on form fields

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

  const statusOptions = [
    { value: "all", label: "All" },
    { value: "active", label: "Active" },
    { value: "pending", label: "Pending" },
    { value: "paused", label: "Paused" },
    { value: "completed", label: "Completed" },
    { value: "cancelled", label: "Cancelled" },
  ];

  const filtered = useMemo(() => {
    return services.filter((s) => {
      if (
        statusFilter !== "all" &&
        normalizeServiceStatus(String(s.status ?? "")) !== statusFilter
      )
        return false;
      if (categoryFilter !== "all" && normalizeCategory(String(s.category ?? "")) !== categoryFilter) return false;
      if (clientFilter !== "all" && (s.clientId ?? "") !== clientFilter) return false;
      return true;
    });
  }, [services, statusFilter, categoryFilter, clientFilter]);

  if (!user) return <p className="text-[#0F172A]">Please log in</p>;
  if (!tenant) return <p className="text-[#0F172A]">Loading tenant…</p>;
  if (loading) return <p className="text-[#0F172A]">Loading services…</p>;

  async function handleCreateService(e: React.FormEvent) {
    e.preventDefault();
    if (!tenant?.id) return;

    setCreateSubmitting(true);
    setCreateError(null);

    try {
      const selectedClient = clients.find((c) => c.id === formClientId);
      if (!selectedClient) {
        setCreateError("Please select a client.");
        return;
      }

      const categoryOpt = MANAGED_SERVICE_CATEGORIES.find((o) => o.value === formCategory);
      if (!categoryOpt) {
        setCreateError("Please select a service category.");
        return;
      }

      const start = new Date(formStartDate);
      if (Number.isNaN(start.getTime())) {
        setCreateError("Please provide a valid start date.");
        return;
      }

      const renewal = formRenewalDate ? new Date(formRenewalDate) : null;
      if (renewal && Number.isNaN(renewal.getTime())) {
        setCreateError("Please provide a valid renewal date.");
        return;
      }

      const selectedProject = formProjectId
        ? projects.find((p) => p.id === formProjectId)
        : undefined;

      const payload: Record<string, unknown> = {
        clientId: formClientId,
        clientName: selectedClient.name ?? selectedClient.email ?? selectedClient.id,
        category: categoryOpt.value,
        categoryLabel: categoryOpt.label,
        status: formStatus,
        startDate: Timestamp.fromDate(start),
        renewalDate: renewal ? Timestamp.fromDate(renewal) : undefined,
        notes: formNotes.trim() || "",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      // Strip optional undefined values (Firestore rejects undefined fields)
      if (!renewal) delete payload.renewalDate;
      if (!selectedProject) {
        delete payload.projectId;
        delete payload.projectName;
      } else {
        payload.projectId = selectedProject.id;
        payload.projectName = selectedProject.name ?? selectedProject.id;
      }

      // NOTE: we intentionally omit projectId/projectName unless selected.
      if (!payload.projectId && selectedProject) {
        payload.projectId = selectedProject.id;
      }

      const created = await addDoc(
        collection(db, "tenants", tenant.id, "services"),
        payload
      );

      // Redirect + refresh.
      setShowCreate(false);
      setFormNotes("");
      setFormRenewalDate("");
      setFormProjectId("");
      router.replace("/portal/services");
      await loadAll();

      // If you want to deep-link into the new service, we can do it later.
      void created;
    } catch (e) {
      const err = e as { message?: string };
      setCreateError(err.message ?? "Failed to create service.");
    } finally {
      setCreateSubmitting(false);
    }
  }

  return (
    <div className="max-w-full min-w-0">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 md:gap-4">
        <div>
          <h1 className="text-[#0F172A] text-xl sm:text-2xl font-semibold break-words">Services</h1>
          <p className="text-slate-500 text-sm mt-1 break-words">
            Managed services Blueteam actively operates for your clients.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 rounded-lg bg-[#4F46E5] text-white font-medium hover:bg-indigo-600 transition-colors w-fit"
        >
          ➕ Add Service
        </button>
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
              {statusOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
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
              {MANAGED_SERVICE_CATEGORIES.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
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

      {showCreate && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-3"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-3xl overflow-hidden">
            <div className="p-5 md:p-6 border-b border-slate-200 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-[#0F172A] text-lg font-semibold break-words">Add Service</h2>
                <p className="text-slate-500 text-sm mt-1 break-words">
                  Assign a managed service to a client.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="p-2 rounded-lg text-slate-500 hover:text-[#0F172A] hover:bg-slate-100 transition-colors shrink-0"
                aria-label="Close"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleCreateService} className="p-5 md:p-6 space-y-4">
              {createError && (
                <div className="bg-rose-50 border border-rose-200 rounded-xl p-3">
                  <p className="text-rose-700 text-sm break-words">{createError}</p>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[#0F172A] mb-1">Client *</label>
                  <select
                    value={formClientId}
                    onChange={(e) => setFormClientId(e.target.value)}
                    required
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-[#0F172A]"
                  >
                    <option value="" disabled>
                      Select client
                    </option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name ?? c.email ?? c.id}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-[#0F172A] mb-1">Service category *</label>
                  <select
                    value={formCategory}
                    onChange={(e) => setFormCategory(e.target.value)}
                    required
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-[#0F172A]"
                  >
                    {MANAGED_SERVICE_CATEGORIES.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-[#0F172A] mb-1">Status *</label>
                  <select
                    value={formStatus}
                    onChange={(e) => setFormStatus(e.target.value)}
                    required
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-[#0F172A]"
                  >
                    <option value="active">Active</option>
                    <option value="pending">Pending Setup</option>
                    <option value="paused">Paused</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-[#0F172A] mb-1">Project (optional)</label>
                  <select
                    value={formProjectId}
                    onChange={(e) => setFormProjectId(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-[#0F172A]"
                  >
                    <option value="">None</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name ?? p.id}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-[#0F172A] mb-1">Start date *</label>
                  <input
                    type="date"
                    value={formStartDate}
                    onChange={(e) => setFormStartDate(e.target.value)}
                    required
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-[#0F172A]"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-[#0F172A] mb-1">Renewal date (optional)</label>
                  <input
                    type="date"
                    value={formRenewalDate}
                    onChange={(e) => setFormRenewalDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-[#0F172A]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-[#0F172A] mb-1">Notes (optional)</label>
                <textarea
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  rows={4}
                  placeholder="Add internal notes / scope / handoff details..."
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-[#0F172A] placeholder:text-slate-400"
                />
              </div>

              <div className="flex flex-wrap gap-2 justify-end pt-1">
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  disabled={createSubmitting}
                  className="px-4 py-2 rounded-lg border border-slate-200 bg-white text-[#0F172A] font-medium disabled:opacity-60 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createSubmitting}
                  className="px-4 py-2 rounded-lg bg-[#4F46E5] text-white font-medium disabled:opacity-60 disabled:cursor-not-allowed hover:bg-indigo-600 transition-colors"
                >
                  {createSubmitting ? "Creating…" : "Create Service"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

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

