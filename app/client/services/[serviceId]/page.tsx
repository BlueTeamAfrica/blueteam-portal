"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
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
  clientActionRequired?: boolean;
  clientActionStatus?: "pending" | "resolved" | string;
  clientActionMessage?: string | null;
  clientActionRequestedAt?: Timestamp | null;
  clientActionResolvedAt?: Timestamp | null;
  clientActionResponse?: string | null;
  clientActionRespondedAt?: Timestamp | null;
  clientActionRespondedByUid?: string | null;
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

function canAccessClientServiceArea(role: string | undefined, clientId: string | undefined): boolean {
  const r = (role ?? "").toLowerCase();
  if (r === "owner" || r === "admin") return true;
  if (r === "client" && clientId?.trim()) return true;
  return false;
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
  const [responseText, setResponseText] = useState("");
  const [respondLoading, setRespondLoading] = useState(false);
  const [respondError, setRespondError] = useState<string | null>(null);
  const [respondSuccess, setRespondSuccess] = useState<string | null>(null);

  useEffect(() => {
    const tid = tenant?.id;
    if (!user || !tid || !serviceId || !canAccessClientServiceArea(role, clientId)) {
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
        if ((role ?? "").toLowerCase() === "client") {
          if ((data.clientId ?? "") !== clientId) {
            setNotFound(true);
            setService(null);
            return;
          }
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
    setRespondSuccess(null);
    setRespondError(null);
    setResponseText("");
  }, [serviceId]);

  useEffect(() => {
    const pending =
      service?.clientActionRequired === true &&
      String(service?.clientActionStatus ?? "").toLowerCase() === "pending";
    if (pending) setRespondSuccess(null);
  }, [service?.clientActionRequired, service?.clientActionStatus]);

  useEffect(() => {
    const tid = tenant?.id;
    const subId = service?.subscriptionId;
    if (!user || !tid || !subId || !canAccessClientServiceArea(role, clientId)) {
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

  async function handleRespondToRequest(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const tid = tenant?.id;
    if (!user || !tid || !serviceId || !responseText.trim()) return;
    setRespondLoading(true);
    setRespondError(null);
    setRespondSuccess(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/client/services/${encodeURIComponent(serviceId)}/respond`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ tenantId: tid, message: responseText }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setRespondError(
          data.error ??
            (res.status === 403
              ? "You do not have permission to respond to this request."
              : "Could not send your response.")
        );
        return;
      }
      setRespondSuccess("Thanks — your team has been notified.");
      setResponseText("");
      const ref = doc(db, "tenants", tid, "services", serviceId);
      const snap = await getDoc(ref);
      if (snap.exists()) setService(snap.data() as Service);
    } catch (err) {
      setRespondError((err as { message?: string }).message ?? "Could not send your response.");
    } finally {
      setRespondLoading(false);
    }
  }

  if (!user) return <p className="text-[#0F172A]">Please log in</p>;
  if (!tenant) return <p className="text-[#0F172A]">Loading tenant…</p>;
  if (!canAccessClientServiceArea(role, clientId)) {
    return (
      <p className="text-[#0F172A] text-sm">
        You do not have permission to view this page.
      </p>
    );
  }
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

  const healthNormalized = normalizeHealth(service.health ?? "");
  const isWaitingClient = healthNormalized === "waiting_client";
  const structuredInputPending =
    service.clientActionRequired === true && service.clientActionStatus === "pending";
  const summaryText = (service.operationalSummary ?? service.description ?? "").trim() || "—";

  const nextActionText = service.nextAction?.trim() ?? "";
  const instructionBody =
    structuredInputPending && service.clientActionMessage?.trim()
      ? service.clientActionMessage.trim()
      : null;

  const nextPrimaryLine = structuredInputPending
    ? instructionBody ?? (nextActionText ? `We need ${nextActionText} from you` : "We need your input to continue")
    : isWaitingClient
      ? nextActionText
        ? `We need ${nextActionText} from you`
        : "We need your input to continue"
      : nextActionText || "No next step scheduled";

  const nextDueFormatted = service.nextActionDue ? formatDate(service.nextActionDue ?? null) : null;
  const billingTypeLower = (service.billingType ?? "").toLowerCase();
  const nextDueLine = nextDueFormatted
    ? billingTypeLower === "recurring"
      ? `Renewal is coming up on ${nextDueFormatted}`
      : isWaitingClient
        ? `Due: ${nextDueFormatted}`
        : `Target: ${nextDueFormatted}`
    : "Target date: —";

  const renewalValue = service.nextBillingDate ?? service.renewalDate ?? null;
  const renewalLabel = renewalValue ? formatDate(renewalValue ?? null) : "—";

  const hasSubscription = Boolean(service.subscriptionId);
  const showInvoiceAction = billingTypeLower === "one_time";
  const showSubscriptionAction = hasSubscription;

  const priceLabel =
    typeof service.price === "number"
      ? service.currency
        ? `${service.currency} ${service.price.toLocaleString()}`
        : service.price.toLocaleString()
      : "—";

  return (
    <div className="max-w-full min-w-0 overflow-x-hidden">
      <div className="flex items-center justify-between gap-3 flex-wrap min-w-0">
        <Link href="/client/services" className="text-indigo-600 hover:underline text-sm">
          ← Back to services
        </Link>
        <div className="flex flex-wrap gap-2">
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

      {respondSuccess ? (
        <div
          className="mt-4 bg-white rounded-xl shadow-sm border border-emerald-200 p-4"
          role="status"
          aria-live="polite"
        >
          <p className="text-emerald-900 text-sm font-medium break-words">{respondSuccess}</p>
        </div>
      ) : null}

      <div className="mt-4 space-y-4 md:space-y-6">
        {/* Overview */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 md:p-6 max-w-full min-w-0">
          <div className="flex items-start justify-between gap-4 flex-wrap min-w-0">
            <div className="min-w-0">
              <h1 className="text-[#0F172A] text-2xl font-semibold break-words">{service.name ?? "Service"}</h1>
              <div className="mt-2 flex flex-wrap gap-2 items-center">
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
            </div>
          </div>
          <p className="mt-3 text-slate-600 text-sm break-words">{summaryText}</p>
        </div>

        {structuredInputPending || isWaitingClient ? (
          <div
            className={`rounded-2xl p-4 md:p-5 border ${
              structuredInputPending
                ? "bg-amber-50 border-amber-200"
                : "bg-indigo-50 border-indigo-100"
            }`}
          >
            <div className="flex items-start gap-3">
              <div
                className={`shrink-0 flex h-10 w-10 items-center justify-center rounded-xl text-lg ${
                  structuredInputPending ? "bg-amber-500/15 text-amber-950" : "bg-indigo-600/10 text-indigo-900"
                }`}
                aria-hidden
              >
                ⚠️
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[#0F172A] font-extrabold text-sm sm:text-base break-words">
                  {structuredInputPending ? "Your input is required" : "Action needed from you"}
                </p>
                {instructionBody ? (
                  <p className="mt-2 text-sm text-[#0F172A]/90 whitespace-pre-wrap break-words leading-relaxed">
                    {instructionBody}
                  </p>
                ) : (
                  <p
                    className={`mt-1 text-sm break-words ${
                      structuredInputPending ? "text-amber-950/85" : "text-indigo-900/80"
                    }`}
                  >
                    {nextPrimaryLine}
                  </p>
                )}
                {structuredInputPending && service.clientActionRequestedAt ? (
                  <p className="mt-2 text-[11px] text-slate-600">
                    Requested {formatDateTime(service.clientActionRequestedAt)}
                  </p>
                ) : null}
                <p className="mt-3 text-xs text-slate-700">
                  Reply via{" "}
                  <Link href="/client/support" className="font-semibold text-indigo-700 hover:underline">
                    support
                  </Link>{" "}
                  or your usual contact so we can continue this service.
                </p>
              </div>
            </div>
          </div>
        ) : null}

        {structuredInputPending ? (
          <div className="bg-white rounded-2xl shadow-sm border border-amber-200 p-5 md:p-6 max-w-full min-w-0">
            <h2 className="text-[#0F172A] text-lg font-semibold break-words">Respond to this request</h2>
            <p className="mt-1 text-xs text-slate-600 max-w-2xl leading-relaxed">
              Type your answer or the information requested above. Your team is notified in the portal when you submit.
            </p>
            <form onSubmit={handleRespondToRequest} className="mt-4 space-y-3">
              {respondError ? (
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 break-words">
                  {respondError}
                </div>
              ) : null}
              <label htmlFor="client-service-response" className="sr-only">
                Your response
              </label>
              <textarea
                id="client-service-response"
                value={responseText}
                onChange={(e) => setResponseText(e.target.value)}
                rows={5}
                required
                disabled={respondLoading}
                className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2.5 text-sm text-[#0F172A] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-200 disabled:opacity-60"
                placeholder="Your response…"
              />
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={respondLoading || !responseText.trim()}
                  className="inline-flex items-center justify-center px-4 py-2.5 rounded-lg bg-amber-700 text-white text-sm font-semibold hover:bg-amber-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {respondLoading ? "Sending…" : "Submit response"}
                </button>
              </div>
            </form>
          </div>
        ) : null}

        {/* Current Status */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 md:p-6 max-w-full min-w-0">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <h2 className="text-[#0F172A] text-lg font-semibold break-words">Current Status</h2>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Health</span>
              <HealthBadge health={service.health} />
            </div>
          </div>

          <div className="mt-4 space-y-4">
            <div>
              <p className="text-xs text-slate-500">Health note</p>
              <p className="mt-1 text-sm text-[#0F172A] whitespace-pre-wrap break-words">
                {service.healthNote?.trim() ? service.healthNote : "—"}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 min-w-0">
                <p className="text-xs text-slate-500">Last checked</p>
                <p className="mt-1 text-sm text-[#0F172A] font-medium break-words">
                  {formatDateTime(service.lastCheckedAt ?? service.updatedAt ?? service.createdAt)}
                </p>
              </div>
              <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 min-w-0">
                <p className="text-xs text-slate-500">Operational summary</p>
                <p className="mt-1 text-sm text-slate-700 break-words whitespace-pre-wrap">
                  {service.operationalSummary ?? "—"}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* What Happens Next */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 md:p-6 max-w-full min-w-0">
          <h2 className="text-[#0F172A] text-lg font-semibold break-words">What Happens Next</h2>
          <div className="mt-4 bg-slate-50 rounded-xl p-4 border border-slate-100 min-w-0">
            <p className="text-xs text-slate-500">Next step</p>
            <p className="mt-1 text-sm sm:text-base font-semibold text-[#0F172A] break-words">{nextPrimaryLine}</p>
            <p className="mt-2 text-xs text-slate-500">{nextDueLine}</p>
          </div>
          {structuredInputPending || isWaitingClient ? (
            <p
              className={`mt-3 text-xs rounded-xl p-3 border ${
                structuredInputPending
                  ? "text-amber-950/90 bg-amber-50 border-amber-100"
                  : "text-indigo-800/80 bg-indigo-50 border-indigo-100"
              }`}
            >
              {structuredInputPending
                ? "Please provide what was requested above so your team can proceed."
                : "Reply to this so we can move the service forward."}
            </p>
          ) : null}
        </div>

        {/* Billing & Renewal */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 md:p-6 max-w-full min-w-0">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <h2 className="text-[#0F172A] text-lg font-semibold break-words">Billing & Renewal</h2>
            <div className="flex flex-wrap gap-2">
              {showSubscriptionAction ? (
                <Link
                  href="/client/subscriptions"
                  className="inline-flex items-center justify-center px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 transition-colors"
                >
                  View subscription
                </Link>
              ) : null}
              {showInvoiceAction ? (
                <Link
                  href="/client/invoices"
                  className="inline-flex items-center justify-center px-3 py-2 rounded-lg border border-slate-200 bg-white text-[#0F172A] text-sm font-medium hover:bg-slate-50 transition-colors"
                >
                  View invoices
                </Link>
              ) : null}
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 min-w-0">
              <p className="text-xs text-slate-500">Billing type</p>
              <p className="mt-1 text-sm text-[#0F172A] font-medium break-words">{getBillingTypeLabel(service.billingType)}</p>
            </div>
            <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 min-w-0">
              <p className="text-xs text-slate-500">Renewal / next billing</p>
              <p className="mt-1 text-sm text-[#0F172A] font-medium break-words">{renewalLabel}</p>
            </div>
            <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 min-w-0">
              <p className="text-xs text-slate-500">Subscription status</p>
              <p className="mt-1 text-sm text-[#0F172A] font-medium break-words">{subStatus ?? "—"}</p>
            </div>
            <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 min-w-0">
              <p className="text-xs text-slate-500">Price</p>
              <p className="mt-1 text-sm text-[#0F172A] font-medium break-words">
                {priceLabel !== "—" ? priceLabel : "—"}
              </p>
            </div>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Billing is managed by Blueteam. If anything looks incorrect, open a support ticket and we’ll fix it.
          </p>
        </div>

        {/* Need Help */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 md:p-6 max-w-full min-w-0">
          <h2 className="text-[#0F172A] text-lg font-semibold break-words">Need Help?</h2>
          <p className="mt-1 text-xs text-slate-500">
            If something doesn&apos;t match what you expected, open a ticket and we&apos;ll take care of it.
          </p>
          <div className="mt-4 flex flex-col sm:flex-row gap-3">
            <Link
              href={supportHref}
              className="inline-flex items-center justify-center px-4 py-2.5 rounded-lg bg-[#4F46E5] text-white text-sm font-semibold hover:bg-indigo-600 transition-colors"
            >
              Open support ticket
            </Link>
            <Link
              href="/client/support"
              className="inline-flex items-center justify-center px-4 py-2.5 rounded-lg border border-slate-200 bg-white text-[#0F172A] text-sm font-medium hover:bg-slate-50 transition-colors"
            >
              Support inbox
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}