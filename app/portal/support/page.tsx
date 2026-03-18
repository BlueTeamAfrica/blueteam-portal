"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
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

export default function PortalSupportPage() {
  const { user } = useAuth();
  const { tenant } = useTenant();

  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterPriority, setFilterPriority] = useState<string>("all");

  const [showForm, setShowForm] = useState(false);
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TicketPriority>("medium");
  const [creating, setCreating] = useState(false);

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
      await addDoc(collection(db, "tenants", tid, "tickets"), {
        subject: subject.trim(),
        description: description.trim(),
        priority,
        status: "open",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdByUid: user.uid,
        createdByRole: "admin",
      });

      setSubject("");
      setDescription("");
      setPriority("medium");
      setShowForm(false);

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
          onClick={() => setShowForm((v) => !v)}
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
            <div className="md:col-span-2">
              <label className="text-xs font-medium text-slate-600">Subject</label>
              <input
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
              onClick={() => setShowForm(false)}
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

