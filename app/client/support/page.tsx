"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  addDoc,
  collection,
  doc,
  getDocs,
  getDoc,
  orderBy,
  query,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/authContext";
import { useTenant } from "@/lib/tenantContext";
import { PORTAL_SELECT_CLASS, PORTAL_SELECT_LABEL_CLASS } from "@/lib/portalSelectStyles";
import { SelectArrowWrap } from "@/components/portal/SelectArrowWrap";

type TicketPriority = "low" | "medium" | "high" | "urgent";
type TicketStatus = "open" | "in_progress" | "waiting_client" | "resolved" | "closed";

type TicketRow = {
  id: string;
  subject?: string;
  serviceId?: string;
  serviceName?: string;
  projectId?: string;
  projectName?: string;
  priority?: TicketPriority;
  status?: TicketStatus;
  createdAt?: { toDate?: () => Date };
  updatedAt?: { toDate?: () => Date };
};

type ServiceOption = {
  id: string;
  name?: string;
  projectId?: string;
  projectName?: string;
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
  if (v === "waiting_client") return badge("bg-sky-50 text-sky-700 border-sky-200", "Waiting on you");
  if (v === "in_progress") return badge("bg-amber-50 text-amber-700 border-amber-200", "In progress");
  return badge("bg-slate-50 text-slate-700 border-slate-200", "Open");
}

export default function ClientSupportPage() {
  const { user, loading: authLoading } = useAuth();
  const { tenant, clientId } = useTenant();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TicketPriority>("medium");
  const [projectId, setProjectId] = useState<string>("");
  const [projectName, setProjectName] = useState<string>("");
  const [serviceId, setServiceId] = useState<string>("");
  const [serviceName, setServiceName] = useState<string>("");
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [creating, setCreating] = useState(false);
  const subjectRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const tenantId = tenant?.id;
    if (!user || !tenantId || !clientId) {
      setLoading(false);
      return;
    }

    const tid = tenantId as string;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const snap = await getDocs(
          query(
            collection(db, "tenants", tid, "tickets"),
            where("clientId", "==", clientId),
            orderBy("updatedAt", "desc")
          )
        );
        setTickets(
          snap.docs.map((d) => {
            const data = d.data() as Omit<TicketRow, "id">;
            return { id: d.id, ...data };
          })
        );
      } catch (e) {
        const err = e as { code?: string; message?: string };
        console.log("SUPPORT DEBUG: load tickets failed", {
          tenantId: tid,
          clientId,
          code: err.code,
          message: err.message,
        });
        setError(
          "Unable to load tickets. " +
            (err.code ? `(${err.code}) ` : "") +
            (err.message ?? "This may require a Firestore index or rule update.")
        );
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [user, tenant?.id, clientId]);

  // Open "new ticket" flow from query params, and optionally prefill project fields.
  useEffect(() => {
    if (!tenant?.id) return;
    const newParam = searchParams?.get("new");
    if (newParam !== "1") return;

    setShowForm(true);
    const qpSubject = searchParams?.get("subject");
    const qpDescription = searchParams?.get("description");
    const qpPriority = searchParams?.get("priority") as TicketPriority | null;
    const qpProjectId = searchParams?.get("projectId");
    const qpProjectName = searchParams?.get("projectName");
    const qpServiceId = searchParams?.get("serviceId");
    const qpServiceName = searchParams?.get("serviceName");
    if (qpSubject) setSubject(qpSubject);
    if (qpDescription) setDescription(qpDescription);
    if (qpPriority && ["low", "medium", "high", "urgent"].includes(qpPriority)) setPriority(qpPriority);
    if (qpProjectId) setProjectId(qpProjectId);
    if (qpProjectName) setProjectName(qpProjectName);
    if (qpServiceId) setServiceId(qpServiceId);
    if (qpServiceName) setServiceName(qpServiceName);
    setTimeout(() => subjectRef.current?.focus(), 0);
  }, [searchParams, tenant?.id]);

  useEffect(() => {
    const tenantId = tenant?.id;
    if (!showForm || !tenantId || !clientId) return;
    const tid = tenantId as string;
    async function loadServices() {
      const snap = await getDocs(collection(db, "tenants", tid, "services"));
      setServices(
        snap.docs
          .map((d) => {
            const data = d.data() as {
              clientId?: string;
              name?: string;
              projectId?: string;
              projectName?: string;
            };
            return {
              id: d.id,
              clientId: data.clientId,
              name: data.name,
              projectId: data.projectId,
              projectName: data.projectName,
            } as ServiceOption & { clientId?: string };
          })
          .filter((s) => (s as ServiceOption & { clientId?: string }).clientId === clientId)
          .map((s) => ({
            id: s.id,
            name: s.name,
            projectId: s.projectId,
            projectName: s.projectName,
          }))
      );
    }
    loadServices();
  }, [showForm, tenant?.id, clientId]);

  const hasTickets = useMemo(() => tickets.length > 0, [tickets.length]);

  async function handleCreateTicket(e: React.FormEvent) {
    e.preventDefault();
    const tenantId = tenant?.id;
    if (!user || !tenantId || !clientId) return;
    if (!subject.trim() || !description.trim()) return;

    const tid = tenantId as string;

    setCreating(true);
    setError(null);
    try {
      // Best-effort: resolve clientName from the client's doc if available.
      // If not present, we still create the ticket safely without a clientName field.
      let clientName: string | undefined = undefined;
      try {
        const clientSnap = await getDoc(doc(db, "tenants", tid, "clients", clientId));
        clientName = clientSnap.exists()
          ? ((clientSnap.data() as { name?: string }).name as string | undefined)
          : undefined;
      } catch {
        clientName = undefined;
      }

      const payload: Record<string, unknown> = {
        subject: subject.trim(),
        description: description.trim(),
        priority,
        status: "open",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdByUid: user.uid,
        createdByRole: "client",
      };

      if (clientId) payload.clientId = clientId;
      if (clientName) payload.clientName = clientName;
      if (projectId) payload.projectId = projectId;
      if (projectName) payload.projectName = projectName;
      if (serviceId) payload.serviceId = serviceId;
      if (serviceName) payload.serviceName = serviceName;

      const created = await addDoc(collection(db, "tenants", tid, "tickets"), payload);

      setSubject("");
      setDescription("");
      setPriority("medium");
      setProjectId("");
      setProjectName("");
      setServiceId("");
      setServiceName("");
      setShowForm(false);
      router.replace(pathname);
      router.push(`/client/support/${created.id}`);
    } catch (e) {
      const err = e as { code?: string; message?: string };
      setError(
        "Ticket could not be created. " +
          (err.code ? `(${err.code}) ` : "") +
          (err.message ?? "Firestore rejected the write (permissions, missing rules, or missing index).")
      );
    } finally {
      setCreating(false);
    }
  }

  if (authLoading) return <p className="text-[#0F172A]">Loading…</p>;
  if (!user) return <p className="text-[#0F172A]">Please log in</p>;
  if (!tenant) return <p className="text-[#0F172A]">Loading tenant…</p>;
  if (!clientId) return <p className="text-[#0F172A]">Loading client…</p>;

  return (
    <div className="max-w-full min-w-0 space-y-4 md:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[#0F172A] text-xl sm:text-2xl font-semibold break-words">Support</h1>
          <p className="text-sm text-slate-600 mt-1 break-words">
            Create a ticket and follow the conversation with the team.
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

      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-xl p-4 text-sm">
          {error}
        </div>
      )}

      {showForm && (
        <form
          onSubmit={handleCreateTicket}
          className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 md:p-6 space-y-3 max-w-full"
        >
          <div className="flex flex-col space-y-3 md:grid md:grid-cols-3 md:gap-3 md:space-y-0">
            <div className="space-y-1 md:col-span-2">
              <label className={PORTAL_SELECT_LABEL_CLASS}>Subject</label>
              <input
                ref={subjectRef}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="w-full min-w-0 h-10 px-3 rounded-lg border border-gray-300 text-sm text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                placeholder="e.g. Request design files / handoff"
                required
              />
            </div>
            <div className="space-y-1">
              <label className={PORTAL_SELECT_LABEL_CLASS}>Priority</label>
              <SelectArrowWrap>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as TicketPriority)}
                  className={PORTAL_SELECT_CLASS}
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </SelectArrowWrap>
            </div>
          </div>
          <div className="space-y-1">
            <label className={PORTAL_SELECT_LABEL_CLASS}>Related service (optional)</label>
            <SelectArrowWrap>
              <select
                value={serviceId}
                onChange={(e) => {
                  setServiceId(e.target.value);
                  const s = services.find((x) => x.id === e.target.value);
                  setServiceName(s?.name ?? "");
                  if (s?.projectId) setProjectId(s.projectId);
                  if (s?.projectName) setProjectName(s.projectName);
                }}
                className={PORTAL_SELECT_CLASS}
              >
                <option value="">Select service</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name ?? s.id}
                  </option>
                ))}
              </select>
            </SelectArrowWrap>
          </div>
          {(projectId || projectName) && (
            <div className="text-xs text-slate-600">
              <span className="text-slate-500">Linked project:</span>{" "}
              <span className="font-medium">{projectName || projectId}</span>
            </div>
          )}
          {(serviceId || serviceName) && (
            <div className="text-xs text-slate-600">
              <span className="text-slate-500">Related service:</span>{" "}
              <span className="font-medium">{serviceName || serviceId}</span>
            </div>
          )}
          <div>
            <label className="text-xs font-medium text-slate-600">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-1 w-full min-w-0 px-3 py-2 rounded-lg border border-slate-200 text-[#0F172A] min-h-[120px]"
              placeholder="Describe what you need help with."
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
        </form>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden max-w-full">
        <div className="w-full overflow-x-auto">
          <table className="min-w-[800px] w-full border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="text-left py-3 px-4 text-sm font-medium text-[#0F172A]">Subject</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-[#0F172A]">Priority</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-[#0F172A]">Status</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-[#0F172A]">Created</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-[#0F172A]">Updated</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="py-6 px-4 text-sm text-slate-500">
                    Loading tickets…
                  </td>
                </tr>
              ) : !hasTickets ? (
                <tr>
                  <td colSpan={5} className="py-10 px-4">
                    <div className="text-center">
                      <p className="text-sm text-slate-600">No tickets yet.</p>
                      <p className="text-xs text-slate-400 mt-1">
                        Create a ticket to start a support conversation.
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                tickets.map((t) => (
                  <tr
                    key={t.id}
                    className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50"
                  >
                    <td className="py-3 px-4 text-[#0F172A] font-medium">
                      <Link
                        href={`/client/support/${t.id}`}
                        className="text-indigo-600 hover:underline"
                      >
                        {t.subject ?? "Untitled ticket"}
                      </Link>
                      {t.projectName || t.serviceName ? (
                        <p className="text-xs text-slate-500 mt-1 truncate">
                          {t.projectName ? `Project: ${t.projectName}` : ""}
                          {t.projectName && t.serviceName ? " · " : ""}
                          {t.serviceName ? `Service: ${t.serviceName}` : ""}
                        </p>
                      ) : null}
                    </td>
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