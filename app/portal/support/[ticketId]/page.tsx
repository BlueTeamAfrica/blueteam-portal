"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/authContext";
import { useTenant } from "@/lib/tenantContext";

type TicketPriority = "low" | "medium" | "high" | "urgent";
type TicketStatus = "open" | "in_progress" | "waiting_client" | "resolved" | "closed";

type TicketDoc = {
  subject?: string;
  description?: string;
  priority?: TicketPriority;
  status?: TicketStatus;
  clientId?: string;
  clientName?: string;
  projectId?: string;
  projectName?: string;
  createdAt?: { toDate?: () => Date };
  updatedAt?: { toDate?: () => Date };
};

type ReplyDoc = {
  message?: string;
  authorRole?: "admin" | "client";
  authorName?: string;
  createdAt?: { toDate?: () => Date };
};

function formatDateTime(ts: { toDate?: () => Date } | undefined): string {
  const d = ts && typeof ts.toDate === "function" ? ts.toDate() : undefined;
  return d ? d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";
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

export default function PortalTicketDetailPage() {
  const params = useParams();
  const ticketId = (params?.ticketId as string | undefined) ?? undefined;
  const { user } = useAuth();
  const { tenant } = useTenant();

  const [ticket, setTicket] = useState<(TicketDoc & { id: string }) | null>(null);
  const [replies, setReplies] = useState<Array<ReplyDoc & { id: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState(false);

  useEffect(() => {
    const tenantId = tenant?.id;
    if (!user || !tenantId || !ticketId) {
      setLoading(false);
      return;
    }

    const tid = tenantId as string;
    const tidTicket = ticketId as string;

    async function load() {
      setLoading(true);
      setNotFound(false);
      try {
        const ref = doc(db, "tenants", tid, "tickets", tidTicket);
        const snap = await getDoc(ref);
        if (!snap.exists()) {
          setNotFound(true);
          setTicket(null);
          setReplies([]);
          return;
        }
        const data = snap.data() as TicketDoc;
        setTicket({ id: snap.id, ...data });

        const repliesSnap = await getDocs(
          query(collection(ref, "replies"), orderBy("createdAt", "asc"))
        );
        setReplies(repliesSnap.docs.map((d) => ({ id: d.id, ...(d.data() as ReplyDoc) })));
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [user, tenant?.id, ticketId]);

  const headerSubtitle = useMemo(() => {
    const bits: string[] = [];
    if (ticket?.clientName) bits.push(ticket.clientName);
    if (ticket?.projectName) bits.push(`Project: ${ticket.projectName}`);
    return bits.join(" · ");
  }, [ticket?.clientName, ticket?.projectName]);

  async function handleSendReply(e: React.FormEvent) {
    e.preventDefault();
    const tenantId = tenant?.id;
    if (!user || !tenantId || !ticketId) return;
    if (!reply.trim()) return;

    setSending(true);
    try {
      const ticketRef = doc(db, "tenants", tenantId, "tickets", ticketId);
      await addDoc(collection(ticketRef, "replies"), {
        message: reply.trim(),
        authorRole: "admin",
        authorUid: user.uid,
        createdAt: serverTimestamp(),
      });
      await updateDoc(ticketRef, {
        updatedAt: serverTimestamp(),
        status: (ticket?.status ?? "open") === "open" ? "in_progress" : (ticket?.status ?? "open"),
      });

      setReply("");

      const repliesSnap = await getDocs(
        query(collection(ticketRef, "replies"), orderBy("createdAt", "asc"))
      );
      setReplies(repliesSnap.docs.map((d) => ({ id: d.id, ...(d.data() as ReplyDoc) })));
      const ticketSnap = await getDoc(ticketRef);
      setTicket({ id: ticketSnap.id, ...(ticketSnap.data() as TicketDoc) });
    } finally {
      setSending(false);
    }
  }

  async function handleStatusChange(newStatus: TicketStatus) {
    const tenantId = tenant?.id;
    if (!user || !tenantId || !ticketId) return;
    setStatusUpdating(true);
    try {
      const ticketRef = doc(db, "tenants", tenantId, "tickets", ticketId);
      await updateDoc(ticketRef, { status: newStatus, updatedAt: serverTimestamp() });
      const snap = await getDoc(ticketRef);
      setTicket({ id: snap.id, ...(snap.data() as TicketDoc) });
    } finally {
      setStatusUpdating(false);
    }
  }

  if (!user) return <p className="text-[#0F172A]">Please log in</p>;
  if (!tenant) return <p className="text-[#0F172A]">Loading tenant…</p>;
  if (loading && !ticket) return <p className="text-[#0F172A]">Loading ticket…</p>;
  if (notFound || !ticket) {
    return (
      <div className="max-w-full min-w-0 space-y-4">
        <Link href="/portal/support" className="text-[#4F46E5] hover:underline text-sm">
          ← Back to support
        </Link>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 text-center">
          <p className="text-slate-600">Ticket not found.</p>
          <Link
            href="/portal/support"
            className="mt-4 inline-block text-[#4F46E5] font-medium hover:underline"
          >
            Back to tickets
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-full min-w-0 space-y-6 md:space-y-8">
      <Link href="/portal/support" className="text-[#4F46E5] hover:underline text-sm inline-block">
        ← Back to support
      </Link>

      <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 md:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-[#0F172A] text-xl sm:text-2xl font-semibold break-words">
              {ticket.subject ?? "Untitled ticket"}
            </h1>
            {headerSubtitle && <p className="text-slate-600 mt-1 break-words">{headerSubtitle}</p>}
            <div className="flex flex-wrap gap-2 mt-2">
              {statusBadge(ticket.status)}
              {priorityBadge(ticket.priority)}
            </div>
            <p className="text-xs text-slate-400 mt-2">
              Created: {formatDateTime(ticket.createdAt)} · Updated: {formatDateTime(ticket.updatedAt)}
            </p>
          </div>

          <div className="flex flex-wrap gap-2 shrink-0">
            <select
              value={ticket.status ?? "open"}
              onChange={(e) => handleStatusChange(e.target.value as TicketStatus)}
              disabled={statusUpdating}
              className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm text-[#0F172A] disabled:opacity-60"
            >
              <option value="open">Open</option>
              <option value="in_progress">In progress</option>
              <option value="waiting_client">Waiting on client</option>
              <option value="resolved">Resolved</option>
              <option value="closed">Closed</option>
            </select>
          </div>
        </div>

        {ticket.description && (
          <div className="mt-4 p-3 rounded-lg bg-slate-50 border border-slate-200">
            <p className="text-sm text-[#0F172A] break-words whitespace-pre-wrap">
              {ticket.description}
            </p>
          </div>
        )}
      </section>

      <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 md:p-5">
        <h2 className="text-[#0F172A] text-base font-semibold mb-3">Conversation</h2>
        {replies.length === 0 ? (
          <div className="py-8 text-center rounded-lg border border-dashed border-slate-200 bg-slate-50/50">
            <p className="text-slate-500 text-sm">No replies yet.</p>
            <p className="text-slate-400 text-xs mt-1">Send the first reply to start the thread.</p>
          </div>
        ) : (
          <ol className="space-y-3">
            {replies.map((r) => {
              const isAdmin = (r.authorRole ?? "admin") === "admin";
              return (
                <li
                  key={r.id}
                  className={`p-3 rounded-lg border ${
                    isAdmin
                      ? "bg-indigo-50/40 border-indigo-100"
                      : "bg-slate-50/60 border-slate-200"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium text-slate-700">
                      {isAdmin ? "Portal team" : "Client"}
                    </p>
                    <p className="text-xs text-slate-500">{formatDateTime(r.createdAt)}</p>
                  </div>
                  <p className="text-sm text-[#0F172A] mt-1 break-words whitespace-pre-wrap">
                    {r.message ?? "—"}
                  </p>
                </li>
              );
            })}
          </ol>
        )}

        <form onSubmit={handleSendReply} className="mt-4 space-y-2">
          <label className="text-xs font-medium text-slate-600">Reply</label>
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            className="w-full min-w-0 px-3 py-2 rounded-lg border border-slate-200 text-[#0F172A] min-h-[110px]"
            placeholder="Write a reply to the client…"
            required
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={sending}
              className="px-3 py-2 sm:px-4 rounded-lg bg-[#4F46E5] text-white text-sm font-medium hover:bg-indigo-600 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {sending ? "Sending…" : "Send reply"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

