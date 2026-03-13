"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { doc, getDoc, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/authContext";
import { useTenant } from "@/lib/tenantContext";

type ProjectData = {
  id: string;
  name?: string;
  clientId?: string;
  clientName?: string;
  status?: string;
  priority?: string;
  description?: string;
  startDate?: Timestamp | null;
  dueDate?: Timestamp | null;
  updatedAt?: Timestamp | null;
  createdAt?: Timestamp | null;
  projectOwner?: string;
  progress?: number;
  phase?: string;
  stagingUrl?: string;
  liveUrl?: string;
  repoUrl?: string;
  milestones?: Array<{
    id?: string;
    title: string;
    status?: "pending" | "in progress" | "completed";
    dueDate?: string;
    notes?: string;
  }>;
  updates?: Array<{
    id?: string;
    text?: string;
    createdAt?: Timestamp | { toDate?: () => Date };
  }>;
};

function formatDate(ts: Timestamp | { toDate?: () => Date } | null | undefined): string {
  if (!ts) return "—";
  if (typeof (ts as Timestamp).toDate === "function") return (ts as Timestamp).toDate().toLocaleDateString();
  if (typeof (ts as { toDate?: () => Date }).toDate === "function") return (ts as { toDate: () => Date }).toDate().toLocaleDateString();
  return "—";
}

function formatDateTime(ts: Timestamp | { toDate?: () => Date } | null | undefined): string {
  if (!ts) return "—";
  let d: Date;
  if (typeof (ts as Timestamp).toDate === "function") d = (ts as Timestamp).toDate();
  else if (typeof (ts as { toDate?: () => Date }).toDate === "function") d = (ts as { toDate: () => Date }).toDate();
  else return "—";
  return d.toLocaleDateString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export default function ProjectDetailPage() {
  const params = useParams();
  const projectId = params?.projectId as string | undefined;
  const { user } = useAuth();
  const { tenant } = useTenant();
  const [project, setProject] = useState<ProjectData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const tenantId = tenant?.id;
    if (!user || !tenantId || !projectId) {
      setLoading(false);
      if (user && tenantId && !projectId) setNotFound(true);
      return;
    }

    async function load() {
      setLoading(true);
      setNotFound(false);
      try {
        const ref = doc(db, "tenants", tenantId, "projects", projectId);
        const snap = await getDoc(ref);
        if (!snap.exists()) {
          setNotFound(true);
          setProject(null);
          return;
        }
        const d = snap.data() as Record<string, unknown>;
        setProject({
          id: snap.id,
          name: d.name as string | undefined,
          clientId: d.clientId as string | undefined,
          clientName: d.clientName as string | undefined,
          status: d.status as string | undefined,
          priority: d.priority as string | undefined,
          description: d.description as string | undefined,
          startDate: d.startDate as Timestamp | null | undefined,
          dueDate: d.dueDate as Timestamp | null | undefined,
          updatedAt: d.updatedAt as Timestamp | null | undefined,
          createdAt: d.createdAt as Timestamp | null | undefined,
          projectOwner: d.projectOwner as string | undefined,
          progress: typeof d.progress === "number" ? d.progress : undefined,
          phase: d.phase as string | undefined,
          stagingUrl: d.stagingUrl as string | undefined,
          liveUrl: d.liveUrl as string | undefined,
          repoUrl: d.repoUrl as string | undefined,
          milestones: Array.isArray(d.milestones) ? d.milestones as ProjectData["milestones"] : undefined,
          updates: Array.isArray(d.updates) ? d.updates as ProjectData["updates"] : undefined,
        });
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [user, tenant?.id, projectId]);

  if (!user) return <p className="text-[#0F172A]">Please log in</p>;
  if (!tenant) return <p className="text-[#0F172A]">Loading tenant…</p>;
  if (loading) return <p className="text-[#0F172A]">Loading project…</p>;
  if (notFound || !project) {
    return (
      <div className="max-w-full min-w-0 space-y-4">
        <Link href="/portal/projects" className="text-[#4F46E5] hover:underline text-sm">← Back to projects</Link>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 text-center">
          <p className="text-slate-600">Project not found.</p>
          <Link href="/portal/projects" className="mt-4 inline-block text-[#4F46E5] font-medium hover:underline">Back to projects</Link>
        </div>
      </div>
    );
  }

  const statusLower = (project.status ?? "").toLowerCase();
  const statusBadge =
    statusLower === "active"
      ? "bg-emerald-100 text-emerald-800 border-emerald-200"
      : statusLower === "completed"
        ? "bg-slate-100 text-slate-700 border-slate-200"
        : statusLower === "on hold" || statusLower === "paused"
          ? "bg-amber-100 text-amber-800 border-amber-200"
          : "bg-slate-100 text-slate-600 border-slate-200";

  const lastUpdated = project.updatedAt ?? project.createdAt;

  return (
    <div className="max-w-full min-w-0 space-y-6 md:space-y-8">
      <Link href="/portal/projects" className="text-[#4F46E5] hover:underline text-sm inline-block">← Back to projects</Link>

      {/* Project header */}
      <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 md:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-[#0F172A] text-xl sm:text-2xl font-semibold break-words">{project.name ?? "Unnamed project"}</h1>
            {project.clientName && (
              <p className="text-slate-600 mt-1 break-words">Client: {project.clientName}</p>
            )}
            <div className="flex flex-wrap gap-2 mt-2">
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${statusBadge}`}>
                {project.status ?? "—"}
              </span>
              {project.priority && (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-200">
                  {project.priority}
                </span>
              )}
            </div>
            {project.description && (
              <p className="text-slate-600 text-sm mt-3 break-words max-w-2xl">{project.description}</p>
            )}
            {lastUpdated && (
              <p className="text-xs text-slate-400 mt-2">Last updated: {formatDateTime(lastUpdated)}</p>
            )}
          </div>
          {/* Quick actions */}
          <div className="flex flex-wrap gap-2 shrink-0">
            <Link
              href="/portal/projects"
              className="px-3 py-2 rounded-lg border border-slate-300 text-slate-800 text-sm font-medium hover:bg-slate-50"
            >
              Edit project
            </Link>
            <Link
              href="/portal/projects"
              className="px-3 py-2 rounded-lg border border-slate-300 text-slate-800 text-sm font-medium hover:bg-slate-50"
            >
              Mark status
            </Link>
            <Link
              href={`/portal/clients${project.clientId ? `?highlight=${project.clientId}` : ""}`}
              className="px-3 py-2 rounded-lg border border-slate-300 text-slate-800 text-sm font-medium hover:bg-slate-50"
            >
              Go to client
            </Link>
            <Link
              href="/portal/invoices"
              className="px-3 py-2 rounded-lg border border-slate-300 text-slate-800 text-sm font-medium hover:bg-slate-50"
            >
              Create invoice
            </Link>
          </div>
        </div>
      </section>

      {/* Overview */}
      <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 md:p-5">
        <h2 className="text-[#0F172A] text-base font-semibold mb-3">Overview</h2>
        <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
          <div>
            <dt className="text-slate-500">Start date</dt>
            <dd className="font-medium text-[#0F172A] mt-0.5">{formatDate(project.startDate)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Due date</dt>
            <dd className="font-medium text-[#0F172A] mt-0.5">{formatDate(project.dueDate)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Project owner</dt>
            <dd className="font-medium text-[#0F172A] mt-0.5">{project.projectOwner ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Progress</dt>
            <dd className="font-medium text-[#0F172A] mt-0.5">
              {project.progress != null ? `${project.progress}%` : "—"}
            </dd>
          </div>
        </dl>
        {project.phase && (
          <p className="text-sm text-slate-600 mt-3">
            <span className="text-slate-500">Current phase:</span> {project.phase}
          </p>
        )}
      </section>

      {/* Milestones */}
      <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 md:p-5">
        <h2 className="text-[#0F172A] text-base font-semibold mb-3">Milestones</h2>
        {project.milestones && project.milestones.length > 0 ? (
          <ul className="space-y-3">
            {project.milestones.map((m, i) => {
              const s = (m.status ?? "pending").toLowerCase();
              const statusCls =
                s === "completed"
                  ? "bg-emerald-100 text-emerald-800"
                  : s === "in progress"
                    ? "bg-blue-100 text-blue-800"
                    : "bg-slate-100 text-slate-600";
              return (
                <li key={m.id ?? i} className="flex flex-col gap-1 p-3 rounded-lg border border-slate-200 bg-slate-50/50">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-[#0F172A]">{m.title}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${statusCls}`}>{m.status ?? "Pending"}</span>
                  </div>
                  {m.dueDate && <p className="text-xs text-slate-500">Due: {m.dueDate}</p>}
                  {m.notes && <p className="text-sm text-slate-600 mt-1 break-words">{m.notes}</p>}
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="py-8 text-center rounded-lg border border-dashed border-slate-200 bg-slate-50/50">
            <p className="text-slate-500 text-sm">No milestones yet.</p>
            <p className="text-slate-400 text-xs mt-1">Add milestones to track project phases.</p>
          </div>
        )}
      </section>

      {/* Updates / activity */}
      <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 md:p-5">
        <h2 className="text-[#0F172A] text-base font-semibold mb-3">Updates &amp; activity</h2>
        {project.updates && project.updates.length > 0 ? (
          <ul className="space-y-3">
            {project.updates.map((u, i) => (
              <li key={u.id ?? i} className="flex flex-col gap-1 p-3 rounded-lg border border-slate-200 bg-slate-50/50 text-sm">
                {u.text && <p className="text-[#0F172A] break-words">{u.text}</p>}
                {u.createdAt && (
                  <p className="text-xs text-slate-500">
                    {typeof (u.createdAt as { toDate?: () => Date }).toDate === "function"
                      ? (u.createdAt as { toDate: () => Date }).toDate().toLocaleDateString(undefined, { dateStyle: "medium", timeStyle: "short" })
                      : "—"}
                  </p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <div className="py-8 text-center rounded-lg border border-dashed border-slate-200 bg-slate-50/50">
            <p className="text-slate-500 text-sm">No updates yet.</p>
            <p className="text-slate-400 text-xs mt-1">Project created {formatDateTime(project.createdAt)}</p>
          </div>
        )}
      </section>

      {/* Links / deliverables */}
      <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 md:p-5">
        <h2 className="text-[#0F172A] text-base font-semibold mb-3">Links &amp; deliverables</h2>
        <div className="space-y-2 text-sm">
          {project.stagingUrl ? (
            <div>
              <span className="text-slate-500">Staging:</span>{" "}
              <a href={project.stagingUrl} target="_blank" rel="noopener noreferrer" className="text-[#4F46E5] hover:underline break-all">
                {project.stagingUrl}
              </a>
            </div>
          ) : null}
          {project.liveUrl ? (
            <div>
              <span className="text-slate-500">Live:</span>{" "}
              <a href={project.liveUrl} target="_blank" rel="noopener noreferrer" className="text-[#4F46E5] hover:underline break-all">
                {project.liveUrl}
              </a>
            </div>
          ) : null}
          {project.repoUrl ? (
            <div>
              <span className="text-slate-500">Repository:</span>{" "}
              <a href={project.repoUrl} target="_blank" rel="noopener noreferrer" className="text-[#4F46E5] hover:underline break-all">
                {project.repoUrl}
              </a>
            </div>
          ) : null}
        </div>
        {!project.stagingUrl && !project.liveUrl && !project.repoUrl && (
          <div className="py-8 text-center rounded-lg border border-dashed border-slate-200 bg-slate-50/50 mt-2">
            <p className="text-slate-500 text-sm">No links added yet.</p>
            <p className="text-slate-400 text-xs mt-1">Add staging, live, or repo URLs when ready.</p>
          </div>
        )}
      </section>
    </div>
  );
}
