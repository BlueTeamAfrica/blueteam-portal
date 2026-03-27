"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { doc, getDoc, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/authContext";
import { useTenant } from "@/lib/tenantContext";

type Service = {
  name?: string;
  category?: string;
  status?: string;
  description?: string;
  notes?: string;
  startDate?: Timestamp | null;
  billingType?: "one_time" | "recurring" | string;
  price?: number;
  currency?: string;
  interval?: "monthly" | "yearly" | string;
  nextBillingDate?: Timestamp | null;
  // Optional health fields (Service Health Dashboard V1)
  health?: string; // "healthy" | "warning" | "critical" | "waiting_client" | "paused"
  healthNote?: string;
  lastCheckedAt?: Timestamp | null;
  nextAction?: string;
  nextActionDue?: Timestamp | null;
  operationalSummary?: string;
  tier?: string;
  renewalDate?: Timestamp;
  clientId?: string;
  clientName?: string;
  projectId?: string;
  projectName?: string;
  updatedAt?: Timestamp;
  createdAt?: Timestamp;
  subscriptionId?: string;
};

function formatDateTime(ts?: Timestamp | null) {
  if (!ts) return "—";
  try {
    return ts.toDate().toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return "—";
  }
}

function formatDate(ts?: Timestamp | null) {
  if (!ts) return "—";
  try {
    return ts.toDate().toLocaleDateString(undefined, { dateStyle: "medium" });
  } catch {
    return "—";
  }
}

function StatusBadge({ status }: { status?: string }) {
  const s = (status ?? "").toLowerCase();
  const styles =
    s === "active"
      ? "bg-emerald-100 text-emerald-800"
      : s === "paused"
        ? "bg-amber-100 text-amber-800"
        : s === "pending"
          ? "bg-indigo-100 text-indigo-800"
          : s === "cancelled" || s === "retired"
            ? "bg-slate-200 text-slate-700"
            : "bg-slate-100 text-slate-600";
  return (
    <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${styles}`}>
      {status ?? "—"}
    </span>
  );
}

function normalizeHealth(input: string) {
  const s = input.trim().toLowerCase();
  if (!s) return "";
  if (s === "healthy") return "healthy";
  if (s === "warning" || s === "warn") return "warning";
  if (s === "critical") return "critical";
  if (s === "waiting_client" || s === "waiting client" || s === "waiting-on-client") return "waiting_client";
  if (s === "paused") return "paused";
  return s;
}

function getHealthLabel(health?: string) {
  const h = normalizeHealth(health ?? "");
  if (h === "healthy") return "Healthy";
  if (h === "warning") return "Warning";
  if (h === "critical") return "Critical";
  if (h === "waiting_client") return "Waiting on Client";
  if (h === "paused") return "Paused";
  return health ?? "—";
}

function HealthBadge({ health }: { health?: string }) {
  const h = normalizeHealth(health ?? "");
  const styles =
    h === "healthy"
      ? "bg-emerald-100 text-emerald-800"
      : h === "warning"
        ? "bg-amber-100 text-amber-800"
        : h === "critical"
          ? "bg-rose-100 text-rose-800"
          : h === "waiting_client"
            ? "bg-indigo-100 text-indigo-800"
            : h === "paused"
              ? "bg-slate-200 text-slate-700"
              : "bg-slate-100 text-slate-600";

  return (
    <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${styles}`}>
      {getHealthLabel(health)}
    </span>
  );
}

function getBillingTypeLabel(v?: string) {
  const s = (v ?? "").toLowerCase();
  if (s === "none") return "Not billable";
  if (s === "one_time") return "One-time";
  if (s === "recurring") return "Recurring";
  return v ? v : "—";
}

export default function ClientServiceDetailPage() {
  const { user } = useAuth();
  const { tenant, role, clientId } = useTenant();
  const params = useParams<{ serviceId?: string }>();
  const serviceId = params?.serviceId;

  const [service, setService] = useState<Service | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [subStatus, setSubStatus] = useState<string | null>(null);

  useEffect(() => {
    const tid = tenant?.id;
    if (!user || !tid || role !== "client" || !clientId || !serviceId) {
      setLoading(false);
      return;
    }

    async function load() {
      setLoading(true);
      setError(null);
      setNotFound(false);
      try {
        const ref = doc(db, "tenants", tid as string, "services", serviceId as string);
        const snap = await getDoc(ref);
        if (!snap.exists()) {
          setNotFound(true);
          setService(null);
          return;
        }
        const data = snap.data() as Service;
        if ((data.clientId ?? "") !== clientId) {
          setNotFound(true);
          setService(null);
          return;
        }
        setService(data);
      } catch (e) {
        const err = e as { message?: string };
        setError(err.message ?? "Unable to load service.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [user, tenant?.id, role, clientId, serviceId]);

  useEffect(() => {
    const tid = tenant?.id;
    const subId = service?.subscriptionId;
    if (!user || !tid || role !== "client" || !clientId || !subId) {
      setSubStatus(null);
      return;
    }
    const tenantId = tid as string;
    const subscriptionId = subId as string;
    let alive = true;
    async function loadSub() {
      try {
        const snap = await getDoc(doc(db, "tenants", tenantId, "subscriptions", subscriptionId));
        if (!alive) return;
        if (!snap.exists()) {
          setSubStatus("—");
          return;
        }
        const data = snap.data() as { status?: string };
        setSubStatus(data.status ?? "—");
      } catch {
        if (!alive) return;
        setSubStatus("—");
      }
    }
    loadSub();
    return () => {
      alive = false;
    };
  }, [service?.subscriptionId, tenant?.id, user, role, clientId]);

  const supportHref = useMemo(() => {
    const subject = service?.name ? `Service: ${service.name} — Support request` : "Service support request";
    const descriptionParts: string[] = [];
    if (serviceId) descriptionParts.push(`Service ID: ${serviceId}`);
    if (service?.projectName) descriptionParts.push(`Project: ${service.projectName}`);
    const description = descriptionParts.join("\n");
    const qp = new URLSearchParams();
    qp.set("new", "1");
    qp.set("subject", subject);
    if (description) qp.set("description", description);
    qp.set("priority", "medium");
    if (service?.projectId) qp.set("projectId", service.projectId);
    if (service?.projectName) qp.set("projectName", service.projectName);
    return `/client/support?${qp.toString()}`;
  }, [service?.name, service?.projectId, service?.projectName, serviceId]);

  if (!user) return <p className="text-[#0F172A]">Please log in</p>;
  if (!tenant) return <p className="text-[#0F172A]">Loading tenant…</p>;
  if (role !== "client" || !clientId) return <p className="text-[#0F172A]">Access denied.</p>;
  if (loading) return <p className="text-[#0F172A]">Loading service…</p>;
  if (notFound) {
    return (
      <div className="max-w-3xl">
        <h1 className="text-[#0F172A] text-2xl font-semibold">Service</h1>
        <div className="mt-6 bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <p className="text-slate-600">Service not found.</p>
          <Link href="/client/services" className="inline-block mt-3 text-indigo-600 hover:underline text-sm">
            ← Back to services
          </Link>
        </div>
      </div>
    );
  }
  if (!service) return <p className="text-[#0F172A]">Service not found.</p>;

  return (
    <div className="max-w-full min-w-0">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Link href="/client/services" className="text-indigo-600 hover:underline text-sm">
          ← Back to services
        </Link>
        <div className="flex flex-wrap gap-2">
          <Link
            href={supportHref}
            className="inline-flex px-3 py-2 rounded-lg bg-[#4F46E5] text-white text-sm font-medium hover:bg-indigo-600 transition-colors"
          >
            Open support ticket
          </Link>
          {service.projectId ? (
            <Link
              href="/client/projects"
              className="inline-flex px-3 py-2 rounded-lg border border-slate-200 bg-white text-[#0F172A] text-sm font-medium hover:bg-slate-50 transition-colors"
            >
              View linked project
            </Link>
          ) : null}
        </div>
      </div>

      {error && (
        <div className="mt-4 bg-white rounded-xl shadow-sm border border-rose-200 p-4">
          <p className="text-rose-700 text-sm break-words">{error}</p>
        </div>
      )}

      <div className="mt-4 bg-white rounded-2xl shadow-sm border border-slate-200 p-5 md:p-6 max-w-full">
        <h1 className="text-[#0F172A] text-2xl font-semibold break-words">{service.name ?? "Service"}</h1>
        <div className="mt-2 flex flex-wrap gap-2">
          <StatusBadge status={service.status} />
          <span className="inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700 capitalize">
            {service.category ?? "—"}
          </span>
          {service.tier ? (
            <span className="inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700">
              Tier: {service.tier}
            </span>
          ) : null}
        </div>
        <p className="mt-3 text-slate-600 text-sm break-words">
          {service.description ?? "No description yet."}
        </p>
        <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
            <p className="text-xs text-slate-500">Start date</p>
            <p className="mt-1 text-[#0F172A] font-medium break-words">{formatDate(service.startDate ?? null)}</p>
          </div>
          <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
            <p className="text-xs text-slate-500">Renewal date</p>
            <p className="mt-1 text-[#0F172A] font-medium">{formatDate(service.renewalDate)}</p>
          </div>
          <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
            <p className="text-xs text-slate-500">Linked project</p>
            <p className="mt-1 text-[#0F172A] font-medium break-words">{service.projectName ?? service.projectId ?? "No linked project"}</p>
          </div>
          <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 sm:col-span-2">
            <p className="text-xs text-slate-500">Notes</p>
            <p className="mt-1 text-sm text-[#0F172A] whitespace-pre-wrap break-words">{service.notes ?? "No notes yet."}</p>
          </div>
          <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
            <p className="text-xs text-slate-500">Created</p>
            <p className="mt-1 text-[#0F172A]">{formatDateTime(service.createdAt)}</p>
          </div>
          <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
            <p className="text-xs text-slate-500">Updated</p>
            <p className="mt-1 text-[#0F172A]">{formatDateTime(service.updatedAt)}</p>
          </div>
        </div>
      </div>

      <div className="mt-4 bg-white rounded-2xl shadow-sm border border-slate-200 p-5 md:p-6 max-w-full">
        <h2 className="text-[#0F172A] font-semibold">Billing</h2>
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
            <p className="text-xs text-slate-500">Billing type</p>
            <p className="mt-1 text-sm text-[#0F172A] font-medium break-words">
              {getBillingTypeLabel(service.billingType)}
            </p>
          </div>
          <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
            <p className="text-xs text-slate-500">Price</p>
            <p className="mt-1 text-sm text-[#0F172A] font-medium break-words">
              {typeof service.price === "number"
                ? `${service.price.toLocaleString()}`
                : "—"}
            </p>
          </div>
          <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
            <p className="text-xs text-slate-500">Currency</p>
            <p className="mt-1 text-sm text-[#0F172A] font-medium break-words">{service.currency ?? "—"}</p>
          </div>
          <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
            <p className="text-xs text-slate-500">Interval</p>
            <p className="mt-1 text-sm text-[#0F172A] font-medium break-words">{service.interval ?? "—"}</p>
          </div>
          <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
            <p className="text-xs text-slate-500">Next billing date</p>
            <p className="mt-1 text-sm text-[#0F172A] font-medium break-words">
              {formatDate(service.nextBillingDate ?? null)}
            </p>
          </div>
          <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
            <p className="text-xs text-slate-500">Subscription status</p>
            <p className="mt-1 text-sm text-[#0F172A] font-medium break-words">{subStatus ?? "—"}</p>
          </div>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Billing is managed by Blueteam. If anything looks incorrect, open a support ticket and we’ll fix it.
        </p>
      </div>

      <div className="mt-4 bg-white rounded-2xl shadow-sm border border-slate-200 p-5 md:p-6 max-w-full">
        <h2 className="text-[#0F172A] font-semibold">Health</h2>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <HealthBadge health={service.health} />
          {service.healthNote ? (
            <span className="inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium bg-white text-slate-700">
              {service.healthNote}
            </span>
          ) : null}
        </div>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
            <p className="text-xs text-slate-500">Last checked</p>
            <p className="mt-1 text-sm text-[#0F172A] font-medium break-words">
              {formatDateTime(service.lastCheckedAt ?? service.updatedAt ?? service.createdAt)}
            </p>
          </div>

          <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
            <p className="text-xs text-slate-500">Next action</p>
            <p className="mt-1 text-sm text-[#0F172A] font-medium break-words">{service.nextAction ?? "—"}</p>
            <p className="text-xs text-slate-500 mt-2">
              Due: {formatDate(service.nextActionDue ?? null)}
            </p>
          </div>
        </div>

        <div className="mt-4 bg-slate-50 rounded-xl p-4 border border-slate-100">
          <p className="text-xs text-slate-500">Operational summary</p>
          <p className="mt-2 text-sm text-slate-700 whitespace-pre-wrap break-words">
            {service.operationalSummary ?? "—"}
          </p>
        </div>
      </div>
    </div>
  );
}

