"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/authContext";
import { useTenant } from "@/lib/tenantContext";

type Project = { id: string; name?: string; clientId?: string; clientName?: string; status?: string };

export default function ClientProjectsPage() {
  const { user } = useAuth();
  const { tenant, role, clientId } = useTenant();
  const [projects, setProjects] = useState<Project[]>([]);
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
      try {
        const q = query(
          collection(db, "tenants", tenantId as string, "projects"),
          where("clientId", "==", clientId)
        );
        const snap = await getDocs(q);
        setProjects(
          snap.docs.map((d) => ({
            id: d.id,
            name: d.data().name,
            clientId: d.data().clientId,
            clientName: d.data().clientName,
            status: d.data().status,
          }))
        );
      } catch {
        setError("Unable to load projects. Please try again.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [user, tenant?.id, role, clientId]);

  if (!user) return <p className="text-[#0F172A]">Please log in</p>;
  if (!tenant) return <p className="text-[#0F172A]">Loading tenant…</p>;
  if (role !== "client" || !clientId) return <p className="text-[#0F172A]">Access denied.</p>;
  if (loading) return <p className="text-[#0F172A]">Loading projects…</p>;
  if (error) return (
    <div>
      <h1 className="text-[#0F172A] text-2xl font-semibold">Projects</h1>
      <div className="mt-6 bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <p className="text-red-600">{error}</p>
      </div>
    </div>
  );

  function StatusBadge({ status }: { status?: string }) {
    const s = (status ?? "").toLowerCase();
    const styles =
      s === "active"
        ? "bg-emerald-100 text-emerald-800"
        : s === "completed"
          ? "bg-slate-100 text-slate-700"
          : s === "on-hold" || s === "on hold"
            ? "bg-amber-100 text-amber-800"
            : "bg-slate-100 text-slate-600";
    return (
      <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${styles}`}>
        {status ?? "—"}
      </span>
    );
  }

  return (
    <div>
      <h1 className="text-[#0F172A] text-2xl font-semibold">Projects</h1>
      <Link href="/client/dashboard" className="inline-block mt-2 text-[#4F46E5] hover:underline text-sm">
        ← Back to dashboard
      </Link>

      {projects.length === 0 ? (
        <div className="mt-6 bg-white rounded-xl shadow-sm border border-slate-200 p-12 text-center">
          <p className="text-slate-500 text-lg">No projects yet</p>
          <p className="text-slate-400 text-sm mt-1">Your projects will appear here when they are assigned.</p>
        </div>
      ) : (
        <div className="mt-6 bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="text-left py-3 px-4 text-sm font-medium text-[#0F172A]">Project Name</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-[#0F172A]">Status</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id} className="border-b border-slate-100 last:border-0">
                  <td className="py-3 px-4 text-[#0F172A]">{p.name ?? "—"}</td>
                  <td className="py-3 px-4">
                    <StatusBadge status={p.status} />
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
