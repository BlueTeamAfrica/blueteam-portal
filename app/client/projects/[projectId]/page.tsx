"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/authContext";
import { useTenant } from "@/lib/tenantContext";

type Project = {
  name?: string;
  status?: string;
  description?: string;
  clientId?: string;
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
    <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${styles}`}>
      {status ?? "—"}
    </span>
  );
}

export default function ClientProjectDetailPage() {
  const { user } = useAuth();
  const { tenant, role, clientId } = useTenant();
  const params = useParams<{ projectId?: string }>();
  const projectId = params?.projectId;

  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const tid = tenant?.id;
    if (!user || !tid || role !== "client" || !clientId || !projectId) {
      setLoading(false);
      return;
    }

    async function load() {
      setLoading(true);
      setNotFound(false);
      try {
        const snap = await getDoc(doc(db, "tenants", tid as string, "projects", projectId as string));
        if (!snap.exists()) {
          setNotFound(true);
          setProject(null);
          return;
        }
        const data = snap.data() as Project;
        if ((data.clientId ?? "") !== clientId) {
          setNotFound(true);
          setProject(null);
          return;
        }
        setProject(data);
      } catch {
        setNotFound(true);
        setProject(null);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [user, tenant?.id, role, clientId, projectId]);

  if (!user) return <p className="text-[#0F172A]">Please log in</p>;
  if (!tenant) return <p className="text-[#0F172A]">Loading tenant…</p>;
  if (role !== "client" || !clientId) return <p className="text-[#0F172A]">Access denied.</p>;
  if (loading) return <p className="text-[#0F172A]">Loading project…</p>;

  if (notFound || !project) {
    return (
      <div className="max-w-full min-w-0">
        <Link href="/client/projects" className="text-indigo-600 hover:underline text-sm">
          ← Back to projects
        </Link>
        <div className="mt-6 bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <p className="text-slate-600">Project not found.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-full min-w-0 space-y-4">
      <Link href="/client/projects" className="text-indigo-600 hover:underline text-sm inline-block py-1">
        ← Back to projects
      </Link>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-[#0F172A] text-xl md:text-2xl font-semibold break-words min-w-0 flex-1">
            {project.name ?? "Project"}
          </h1>
          <StatusBadge status={project.status} />
        </div>
        {project.description?.trim() ? (
          <p className="mt-4 text-slate-600 text-sm leading-relaxed break-words">{project.description}</p>
        ) : (
          <p className="mt-4 text-slate-500 text-sm">No summary has been added for this project yet.</p>
        )}
      </div>
    </div>
  );
}
