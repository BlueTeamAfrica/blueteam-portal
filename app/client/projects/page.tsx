"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/authContext";
import { useTenant } from "@/lib/tenantContext";

type Project = {
  id: string;
  name?: string;
  clientId?: string;
  clientName?: string;
  status?: string;
  description?: string;
};

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
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${styles}`}>
      {status ?? "—"}
    </span>
  );
}

export default function ClientProjectsPage() {
  const router = useRouter();
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
          snap.docs.map((d) => {
            const data = d.data();
            return {
              id: d.id,
              name: data.name,
              clientId: data.clientId,
              clientName: data.clientName,
              status: data.status,
              description: typeof data.description === "string" ? data.description : undefined,
            };
          })
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
    <div className="max-w-full min-w-0">
      <h1 className="text-[#0F172A] text-2xl font-semibold">Projects</h1>
      <div className="mt-6 bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <p className="text-red-600">{error}</p>
      </div>
    </div>
  );

  return (
    <div className="max-w-full min-w-0">
      <div>
        <h1 className="text-[#0F172A] text-2xl font-semibold">Projects</h1>
        <Link href="/client/dashboard" className="inline-block mt-2 text-indigo-600 hover:underline text-sm py-1">
          ← Back to dashboard
        </Link>
      </div>

      {projects.length === 0 ? (
        <div className="mt-6 bg-white rounded-xl shadow-sm border border-slate-200 p-8 md:p-12 text-center">
          <p className="text-slate-500 text-lg">No projects yet</p>
          <p className="text-slate-400 text-sm mt-1">Your projects will appear here when they are assigned.</p>
        </div>
      ) : (
        <>
          <ul className="mt-6 md:hidden space-y-3 list-none p-0 m-0">
            {projects.map((p) => (
              <li
                key={p.id}
                className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm min-w-0"
              >
                <div className="flex items-start justify-between gap-3 min-w-0">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Project</p>
                    <p className="text-lg font-semibold text-[#0F172A] break-words">{p.name ?? "—"}</p>
                  </div>
                  <StatusBadge status={p.status} />
                </div>
                {p.description?.trim() ? (
                  <p className="mt-3 text-sm text-slate-600 leading-relaxed line-clamp-3">{p.description.trim()}</p>
                ) : (
                  <p className="mt-3 text-sm text-slate-400">No summary yet.</p>
                )}
                <button
                  type="button"
                  onClick={() => router.push(`/client/projects/${p.id}`)}
                  className="mt-4 w-full min-h-11 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-[#0F172A] shadow-sm hover:bg-slate-50 transition-colors"
                >
                  View project
                </button>
              </li>
            ))}
          </ul>

          <div className="mt-6 hidden md:block bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden max-w-full">
            <div className="w-full overflow-x-auto">
              <table className="min-w-[560px] w-full border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="text-left py-3 px-4 text-sm font-medium text-[#0F172A]">Project name</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-[#0F172A]">Status</th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-[#0F172A]">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {projects.map((p) => (
                    <tr key={p.id} className="border-b border-slate-100 last:border-0">
                      <td className="py-3 px-4 text-[#0F172A] font-medium">
                        <div>{p.name ?? "—"}</div>
                        {p.description?.trim() ? (
                          <p className="text-xs text-slate-500 mt-1 line-clamp-2 max-w-xl">{p.description.trim()}</p>
                        ) : null}
                      </td>
                      <td className="py-3 px-4">
                        <StatusBadge status={p.status} />
                      </td>
                      <td className="py-3 px-4 text-right">
                        <Link
                          href={`/client/projects/${p.id}`}
                          className="inline-flex min-h-11 items-center justify-end text-sm font-semibold text-indigo-600 hover:underline px-2"
                        >
                          Open
                        </Link>
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
