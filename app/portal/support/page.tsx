"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  addDoc,
  collection,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/authContext";
import { useTenant } from "@/lib/tenantContext";

type TicketPriority = "low" | "medium" | "high" | "urgent";
type TicketStatus = "open" | "in_progress" | "waiting_client" | "resolved" | "closed";

type TicketRow = {
  id: string;
  subject?: string;
  clientId?: string;
  clientName?: string;
  projectId?: string;
  projectName?: string;
  priority?: TicketPriority;
  status?: TicketStatus;
  createdAt?: { toDate?: () => Date };
  updatedAt?: { toDate?: () => Date };
};

function formatDate(ts: { toDate?: () => Date } | undefined): string {
  const d = ts && typeof ts.toDate === "function" ? ts.toDate() : undefined;
  return d ? d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—";
}

function badge(cls: string, label: string) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${cls}`}>
      {label}
    </span>
  );
}

function priorityBadge(p?: TicketPriority) {
  const v = (p ?? "medium").toLowerCase() as TicketPriority;
  if (v === "urgent") return badge("bg-rose-50 text-rose-700 border-rose-200", "Urgent");
  if (v === "high") return badge("bg-amber-50 text-amber-700 border-amber-200", "High");
  if (v === "low") return badge("bg-slate-50 text-slate-600 border-slate-200", "Low");
  return badge("bg-indigo-50 text-indigo-700 border-indigo-200", "Medium");
}

function statusBadge(s?: TicketStatus) {
  const v = (s ?? "open").toLowerCase() as TicketStatus;
  if (v === "resolved") return badge("bg-emerald-50 text-emerald-700 border-emerald-200", "Resolved");
  if (v === "closed") return badge("bg-slate-50 text-slate-600 border-slate-200", "Closed");
  if (v === "waiting_client") return badge("bg-sky-50 text-sky-700 border-sky-200", "Waiting on client");
  if (v === "in_progress") return badge("bg-amber-50 text-amber-700 border-amber-200", "In progress");
  return badge("bg-slate-50 text-slate-700 border-slate-200", "Open");
}

type ClientOption = { id: string; name?: string };
type ProjectOption = { id: string; name?: string; clientId?: string; clientName?: string };

export default function PortalSupportPage() {
  const { user, loading: authLoading } = useAuth();
  const { tenant } = useTenant();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterPriority, setFilterPriority] = useState<string>("all");

  const [showForm, setShowForm] = useState(false);
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TicketPriority>("medium");
  const [clientId, setClientId] = useState<string>("");
  const [clientName, setClientName] = useState<string>("");
  const [projectId, setProjectId] = useState<string>("");
  const [projectName, setProjectName] = useState<string>("");
  const [creating, setCreating] = useState(false);
  const subjectRef = useRef<HTMLInputElement | null>(null);

  const [clients, setClients] = useState<ClientOption[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);

  useEffect(() => {
    const tenantId = tenant?.id;
    if (!user || !tenantId) {
      setLoading(false);
      return;
    }

    const tid = tenantId as string;

    async function load() {
      setLoading(true);
      try {
        const snap = await getDocs(
          query(
            collection(db, "tenants", tid, "tickets"),
            orderBy("updatedAt", "desc")
          )
        );
        setTickets(
          snap.docs.map((d) => {
            const data = d.data() as Omit<TicketRow, "id">;
            return { id: d.id, ...data };
          })
        );
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [user, tenant?.id]);

  // Open "new ticket" flow from query params, and optionally prefill project/client fields.
  useEffect(() => {
    if (!tenant?.id) return;

    const newParam = searchParams?.get("new");
    if (newParam !== "1") return;

    setShowForm(true);

    const qpSubject = searchParams?.get("subject");
    const qpPriority = searchParams?.get("priority") as TicketPriority | null;
    const qpClientId = searchParams?.get("clientId");
    const qpClientName = searchParams?.get("clientName");
    const qpProjectId = searchParams?.get("projectId");
    const qpProjectName = searchParams?.get("projectName");
    const qpDescription = searchParams?.get("description");

    if (qpSubject) setSubject(qpSubject);
    if (qpDescription) setDescription(qpDescription);
    if (qpPriority && ["low", "medium", "high", "urgent"].includes(qpPriority)) setPriority(qpPriority);
    if (qpClientId) setClientId(qpClientId);
    if (qpClientName) setClientName(qpClientName);
    if (qpProjectId) setProjectId(qpProjectId);
    if (qpProjectName) setProjectName(qpProjectName);

    // Best-effort focus
    setTimeout(() => subjectRef.current?.focus(), 0);
  }, [searchParams, tenant?.id]);

  // Load client + project options when the form is visible
  useEffect(() => {
    const tenantId = tenant?.id;
    if (!user || !tenantId || !showForm) return;

    const tid = tenantId as string;
    async function loadOptions() {
      const [clientsSnap, projectsSnap] = await Promise.all([
        getDocs(collection(db, "tenants", tid, "clients")),
        getDocs(collection(db, "tenants", tid, "projects")),
      ]);
      setClients(
        clientsSnap.docs.map((d) => ({ id: d.id, name: (d.data() as { name?: string }).name }))
      );
      setProjects(
        projectsSnap.docs.map((d) => {
          const data = d.data() as { name?: string; clientId?: string; clientName?: string };
          return { id: d.id, name: data.name, clientId: data.clientId, clientName: data.clientName };
        })
      );
    }
    loadOptions();
  }, [showForm, tenant?.id, user]);

  const filtered = useMemo(() => {
    return tickets.filter((t) => {
      const sOk = filterStatus === "all" || (t.status ?? "open") === filterStatus;
      const pOk = filterPriority === "all" || (t.priority ?? "medium") === filterPriority;
      return sOk && pOk;
    });
  }, [tickets, filterPriority, filterStatus]);

  async function handleCreateTicket(e: React.FormEvent) {
    e.preventDefault();
    const tenantId = tenant?.id;
    if (!user || !tenantId) return;
    if (!subject.trim() || !description.trim()) return;

    const tid = tenantId as string;

    setCreating(true);
    try {
      const resolvedClient =
        clientId ? clients.find((c) => c.id === clientId) : undefined;
      const resolvedProject =
        projectId ? projects.find((p) => p.id === projectId) : undefined;
      const finalClientName = clientName || resolvedClient?.name || resolvedProject?.clientName;
      const finalProjectName = projectName || resolvedProject?.name;

      await addDoc(collection(db, "tenants", tid, "tickets"), {
        subject: subject.trim(),
        description: description.trim(),
        priority,
        status: "open",
        clientId: clientId || resolvedProject?.clientId || undefined,
        clientName: finalClientName || undefined,
        projectId: projectId || undefined,
        projectName: finalProjectName || undefined,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdByUid: user.uid,
        createdByRole: "admin",
      });

      setSubject("");
      setDescription("");
      setPriority("medium");
      setClientId("");
      setClientName("");
      setProjectId("");
      setProjectName("");
      setShowForm(false);
      router.replace(pathname);

      const snap = await getDocs(
        query(collection(db, "tenants", tid, "tickets"), orderBy("updatedAt", "desc"))
      );
      setTickets(
        snap.docs.map((d) => {
          const data = d.data() as Omit<TicketRow, "id">;
          return { id: d.id, ...data };
        })
      );
    } finally {
      setCreating(false);
    }
  }

  if (authLoading) return <p className="text-[#0F172A]">Loading…</p>;
  if (!user) return <p className="text-[#0F172A]">Please log in</p>;
  if (!tenant) return <p className="text-[#0F172A]">Loading tenant…</p>;

  return (
    <div className="max-w-full min-w-0 space-y-4 md:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[#0F172A] text-xl sm:text-2xl font-semibold break-words">Support</h1>
          <p className="text-sm text-slate-600 mt-1 break-words">
            Track tickets, reply to clients, and keep issues moving.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setShowForm(true);
            router.replace(`${pathname}?new=1`);
            setTimeout(() => subjectRef.current?.focus(), 0);
          }}
          className="px-3 py-2 sm:px-4 rounded-lg bg-[#4F46E5] text-white text-sm font-medium hover:bg-indigo-600 transition-colors whitespace-nowrap w-fit"
        >
          ➕ New Ticket
        </button>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm text-[#0F172A] w-full sm:w-auto min-w-0"
        >
          <option value="all">All statuses</option>
          <option value="open">Open</option>
          <option value="in_progress">In progress</option>
          <option value="waiting_client">Waiting on client</option>
          <option value="resolved">Resolved</option>
          <option value="closed">Closed</option>
        </select>
        <select
          value={filterPriority}
          onChange={(e) => setFilterPriority(e.target.value)}
          className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm text-[#0F172A] w-full sm:w-auto min-w-0"
        >
          <option value="all">All priorities</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="urgent">Urgent</option>
        </select>
      </div>

      {showForm && (
        <form
          onSubmit={handleCreateTicket}
          className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 md:p-6 space-y-3 max-w-full"
        >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-600">Client (optional)</label>
              <select
                value={clientId}
                onChange={(e) => {
                  setClientId(e.target.value);
                  const c = clients.find((x) => x.id === e.target.value);
                  setClientName(c?.name ?? "");
                }}
                className="mt-1 w-full min-w-0 px-3 py-2 rounded-lg border border-slate-200 text-[#0F172A] bg-white"
              >
                <option value="">Select client</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name ?? c.id}
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="text-xs font-medium text-slate-600">Project (optional)</label>
              <select
                value={projectId}
                onChange={(e) => {
                  setProjectId(e.target.value);
                  const p = projects.find((x) => x.id === e.target.value);
                  setProjectName(p?.name ?? "");
                  if (p?.clientId) setClientId(p.clientId);
                  if (p?.clientName) setClientName(p.clientName);
                }}
                className="mt-1 w-full min-w-0 px-3 py-2 rounded-lg border border-slate-200 text-[#0F172A] bg-white"
              >
                <option value="">Select project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {(p.name ?? p.id) + (p.clientName ? ` — ${p.clientName}` : "")}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-2">
              <label className="text-xs font-medium text-slate-600">Subject</label>
              <input
                ref={subjectRef}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="mt-1 w-full min-w-0 px-3 py-2 rounded-lg border border-slate-200 text-[#0F172A]"
                placeholder="e.g. Invoice PDF download not working"
                required
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600">Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as TicketPriority)}
                className="mt-1 w-full min-w-0 px-3 py-2 rounded-lg border border-slate-200 text-[#0F172A]"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-1 w-full min-w-0 px-3 py-2 rounded-lg border border-slate-200 text-[#0F172A] min-h-[120px]"
              placeholder="Describe the issue, expected behavior, and any helpful context."
              required
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={creating}
              className="px-3 py-2 sm:px-4 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {creating ? "Creating…" : "Create ticket"}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                router.replace(pathname);
              }}
              className="px-3 py-2 sm:px-4 rounded-lg border border-slate-300 text-slate-800 text-sm font-medium hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
          <p className="text-xs text-slate-400">
            Optional client/project linking can be added in a later iteration.
          </p>
        </form>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden max-w-full">
        <div className="w-full overflow-x-auto">
          <table className="min-w-[900px] w-full border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="text-left py-3 px-4 text-sm font-medium text-[#0F172A]">Subject</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-[#0F172A]">Client</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-[#0F172A]">Priority</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-[#0F172A]">Status</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-[#0F172A]">Created</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-[#0F172A]">Updated</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-6 px-4 text-sm text-slate-500">
                    Loading tickets…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 px-4">
                    <div className="text-center">
                      <p className="text-sm text-slate-600">No tickets yet.</p>
                      <p className="text-xs text-slate-400 mt-1">
                        Create a ticket to start a support thread with your team or clients.
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map((t) => (
                  <tr
                    key={t.id}
                    className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50"
                  >
                    <td className="py-3 px-4 text-[#0F172A] font-medium">
                      <Link
                        href={`/portal/support/${t.id}`}
                        className="text-indigo-600 hover:underline"
                      >
                        {t.subject ?? "Untitled ticket"}
                      </Link>
                      {t.projectName && (
                        <p className="text-xs text-slate-500 mt-1 truncate">
                          Project: {t.projectName}
                        </p>
                      )}
                    </td>
                    <td className="py-3 px-4 text-[#0F172A]">{t.clientName ?? "—"}</td>
                    <td className="py-3 px-4">{priorityBadge(t.priority)}</td>
                    <td className="py-3 px-4">{statusBadge(t.status)}</td>
                    <td className="py-3 px-4 text-[#0F172A]">{formatDate(t.createdAt)}</td>
                    <td className="py-3 px-4 text-[#0F172A]">{formatDate(t.updatedAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

