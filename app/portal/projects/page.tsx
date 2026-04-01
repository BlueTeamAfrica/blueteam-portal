"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { collection, getDocs, addDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/authContext";
import { useTenant } from "@/lib/tenantContext";
import { PORTAL_SELECT_CLASS, PORTAL_SELECT_LABEL_CLASS } from "@/lib/portalSelectStyles";
import { SelectArrowWrap } from "@/components/portal/SelectArrowWrap";

type Client = { id: string; name?: string; email?: string; status?: string };
type Project = { id: string; name?: string; clientId?: string; clientName?: string; status?: string };

export default function ProjectsPage() {
  const { user } = useAuth();
  const { tenant } = useTenant();
  const [clients, setClients] = useState<Client[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [clientId, setClientId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const tenantId = tenant?.id;
    if (!user || !tenantId) {
      setLoading(false);
      return;
    }

    async function load() {
      setLoading(true);
      try {
        const [clientsSnap, projectsSnap] = await Promise.all([
          getDocs(collection(db, "tenants", tenantId as string, "clients")),
          getDocs(collection(db, "tenants", tenantId as string, "projects")),
        ]);
        setClients(
          clientsSnap.docs.map((d) => ({
            id: d.id,
            name: d.data().name,
            email: d.data().email,
            status: d.data().status,
          }))
        );
        setProjects(
          projectsSnap.docs.map((d) => ({
            id: d.id,
            name: d.data().name,
            clientId: d.data().clientId,
            clientName: d.data().clientName,
            status: d.data().status,
          }))
        );
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [user, tenant?.id]);

  async function handleAddProject(e: React.FormEvent) {
    e.preventDefault();
    const tenantId = tenant?.id;
    if (!tenantId) return;
    if (!name.trim() || !clientId) return;

    const selectedClient = clients.find((c) => c.id === clientId);
    const clientName = selectedClient?.name ?? "";

    setSubmitting(true);
    try {
      await addDoc(collection(db, "tenants", tenantId, "projects"), {
        name: name.trim(),
        clientId,
        clientName,
        status: "active",
        createdAt: serverTimestamp(),
        startDate: serverTimestamp(),
      });

      setName("");
      setClientId("");
      setShowForm(false);

      const snap = await getDocs(collection(db, "tenants", tenantId, "projects"));
      setProjects(
        snap.docs.map((d) => ({
          id: d.id,
          name: d.data().name,
          clientId: d.data().clientId,
          clientName: d.data().clientName,
          status: d.data().status,
        }))
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (!user) return <p className="text-[#0F172A]">Please log in</p>;
  if (!tenant) return <p className="text-[#0F172A]">Loading tenant…</p>;
  if (loading) return <p className="text-[#0F172A]">Loading projects…</p>;

  return (
    <div className="max-w-full min-w-0">
      <h1 className="text-[#0F172A] text-xl sm:text-2xl font-semibold break-words">Projects</h1>

      <div className="mt-3 mb-3 md:mt-4 md:mb-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="px-4 py-2 rounded-lg bg-[#4F46E5] text-white font-medium hover:bg-indigo-600 transition-colors"
        >
          ➕ Add Project
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleAddProject}
          className="mb-4 md:mb-6 flex flex-col space-y-3 sm:flex-row sm:flex-wrap sm:items-end sm:gap-3 sm:space-y-0 bg-white rounded-xl shadow-sm border border-slate-200 p-4 max-w-full"
        >
          <input
            type="text"
            placeholder="Project name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="w-full min-w-0 sm:min-w-[200px] h-10 px-3 rounded-lg border border-gray-300 text-[#0F172A] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
          />
          <div className="space-y-1 w-full sm:w-auto sm:min-w-[220px] sm:flex-1 min-w-0">
            <label className={PORTAL_SELECT_LABEL_CLASS}>Client *</label>
            <SelectArrowWrap>
              <select
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                required
                className={PORTAL_SELECT_CLASS}
              >
                <option value="">Select client</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name ?? c.email ?? c.id}
                  </option>
                ))}
              </select>
            </SelectArrowWrap>
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium disabled:opacity-60 disabled:cursor-not-allowed hover:bg-emerald-700 transition-colors"
          >
            {submitting ? "Adding…" : "Save"}
          </button>
        </form>
      )}

      {projects.length > 0 ? (
        <>
          <div className="md:hidden mt-4 space-y-3">
            {projects.map((project) => (
              <Link
                key={project.id}
                href={`/portal/projects/${project.id}`}
                className="block rounded-xl border border-slate-200 bg-white p-4 shadow-sm active:bg-slate-50 transition-colors"
              >
                <p className="font-semibold text-[#0F172A] break-words">{project.name?.trim() || "Project"}</p>
                <p className="text-sm text-slate-600 mt-1">{project.clientName ?? "—"}</p>
                <p className="text-xs font-medium text-slate-500 mt-2 uppercase tracking-wide">
                  {project.status ?? "—"}
                </p>
              </Link>
            ))}
          </div>

          <div className="hidden md:block bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden max-w-full">
            <div className="w-full overflow-x-auto">
              <table className="min-w-[800px] w-full border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="text-left py-3 px-4 text-sm font-medium text-[#0F172A]">Project Name</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-[#0F172A]">Client Name</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-[#0F172A]">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {projects.map((project) => (
                    <tr key={project.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50">
                      <td className="py-3 px-4 text-[#0F172A] font-medium">
                        <Link href={`/portal/projects/${project.id}`} className="text-indigo-600 hover:underline">
                          {project.name ?? "—"}
                        </Link>
                      </td>
                      <td className="py-3 px-4 text-[#0F172A]">{project.clientName ?? "—"}</td>
                      <td className="py-3 px-4 text-[#0F172A]">{project.status ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <p className="mt-4 text-slate-500">No projects.</p>
      )}
    </div>
  );
}
