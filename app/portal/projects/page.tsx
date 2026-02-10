"use client";

import { useEffect, useState } from "react";
import { collection, getDocs, addDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/authContext";
import { useTenant } from "@/lib/tenantContext";

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
    if (!user || !tenant?.id) {
      setLoading(false);
      return;
    }

    async function load() {
      setLoading(true);
      try {
        const [clientsSnap, projectsSnap] = await Promise.all([
          getDocs(collection(db, "tenants", tenant.id, "clients")),
          getDocs(collection(db, "tenants", tenant.id, "projects")),
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
    if (!tenant?.id) return;
    if (!name.trim() || !clientId) return;

    const selectedClient = clients.find((c) => c.id === clientId);
    const clientName = selectedClient?.name ?? "";

    setSubmitting(true);
    try {
      await addDoc(collection(db, "tenants", tenant.id, "projects"), {
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

      const snap = await getDocs(collection(db, "tenants", tenant.id, "projects"));
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
    <div>
      <h1 className="text-[#0F172A] text-2xl font-semibold">Projects</h1>

      <div className="mt-4 mb-4">
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="px-4 py-2 rounded-lg bg-[#4F46E5] text-white font-medium hover:bg-indigo-600 transition-colors"
        >
          ➕ Add Project
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleAddProject} className="mb-6 flex flex-wrap gap-3 items-center bg-white rounded-xl shadow-sm border border-slate-200 p-4">
          <input
            type="text"
            placeholder="Project name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="px-3 py-2 rounded-lg border border-slate-200 min-w-[200px] text-[#0F172A] placeholder:text-slate-400"
          />
          <select
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            required
            className="px-3 py-2 rounded-lg border border-slate-200 min-w-[220px] text-[#0F172A]"
          >
            <option value="">Select client</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name ?? c.email ?? c.id}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium disabled:opacity-60 disabled:cursor-not-allowed hover:bg-emerald-700 transition-colors"
          >
            {submitting ? "Adding…" : "Save"}
          </button>
        </form>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <th className="text-left py-3 px-4 text-sm font-medium text-[#0F172A]">Project Name</th>
              <th className="text-left py-3 px-4 text-sm font-medium text-[#0F172A]">Client Name</th>
              <th className="text-left py-3 px-4 text-sm font-medium text-[#0F172A]">Status</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((project) => (
              <tr key={project.id} className="border-b border-slate-100 last:border-0">
                <td className="py-3 px-4 text-[#0F172A]">{project.name ?? "—"}</td>
                <td className="py-3 px-4 text-[#0F172A]">{project.clientName ?? "—"}</td>
                <td className="py-3 px-4 text-[#0F172A]">{project.status ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {projects.length === 0 && <p className="mt-4 text-slate-500">No projects.</p>}
    </div>
  );
}
