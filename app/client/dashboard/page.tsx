"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  collection,
  getDocs,
  query,
  where,
  doc,
  getDoc,
  orderBy,
  limit,
  Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/authContext";
import { useTenant } from "@/lib/tenantContext";
import {
  clientDashboardHealthBucket,
  getClientFriendlyHealthSummary,
  healthPreviewPriority,
  normalizeServiceHealth,
} from "@/lib/serviceHealth";

type RecentActivityItem = {
  id: string;
  title: string;
  subtitle?: string;
  dateLabel: string;
  icon: string;
  timestamp?: Date;
};

function getBillingTypeLabel(v?: string) {
  const s = (v ?? "").toLowerCase();
  if (s === "none") return "Not billable";
  if (s === "one_time") return "One-time";
  if (s === "recurring") return "Recurring";
  return v ? v : "—";
}

type ClientServiceHealthRow = {
  id: string;
  name: string;
  health: string;
  friendlyLine: string;
  healthNote?: string;
  nextAction?: string;
  nextActionDueLabel: string;
  lastCheckedLabel: string;
};

type ClientServicesHealth = {
  counts: {
    healthy: number;
    warning: number;
    critical: number;
    waiting_client: number;
  };
  services: ClientServiceHealthRow[];
  totalServices: number;
};

function formatServiceDue(ts?: Timestamp | null) {
  if (!ts) return "—";
  try {
    if (typeof ts.toDate === "function") {
      return ts.toDate().toLocaleDateString(undefined, { dateStyle: "medium" });
    }
  } catch {
    /* ignore */
  }
  return "—";
}

function formatLastChecked(
  lastCheckedAt?: Timestamp | null,
  updatedAt?: Timestamp | null,
  createdAt?: Timestamp | null
) {
  const pick = lastCheckedAt ?? updatedAt ?? createdAt;
  if (!pick) return "—";
  try {
    if (typeof pick.toDate === "function") {
      return pick.toDate().toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    }
  } catch {
    /* ignore */
  }
  return "—";
}

function healthStatusAccentClass(health?: string) {
  const h = normalizeServiceHealth(health);
  if (h === "critical") return "border-l-rose-500 bg-rose-50/40";
  if (h === "warning") return "border-l-amber-500 bg-amber-50/35";
  if (h === "waiting_client") return "border-l-indigo-500 bg-indigo-50/35";
  if (h === "paused") return "border-l-slate-400 bg-slate-50/60";
  return "border-l-emerald-500 bg-emerald-50/30";
}

function friendlyLineColorClass(health?: string) {
  const h = normalizeServiceHealth(health);
  if (h === "critical") return "text-rose-800";
  if (h === "warning") return "text-amber-900";
  if (h === "waiting_client") return "text-indigo-900";
  if (h === "paused") return "text-slate-700";
  return "text-emerald-900";
}

type LoadFailureDetail = {
  section: string;
  consoleLabel: string;
  code: string;
  message: string;
  classification: "permissions" | "index" | "bad_data" | "network" | "unknown";
};

function classifyFirebaseError(code: string, message: string): LoadFailureDetail["classification"] {
  const c = code.toLowerCase();
  const m = message.toLowerCase();
  if (c === "permission-denied") return "permissions";
  if (c === "failed-precondition" || m.includes("index") || c === "unimplemented") return "index";
  if (
    c === "invalid-argument" ||
    m.includes("unsupported field value") ||
    m.includes("invalid data")
  ) {
    return "bad_data";
  }
  if (c === "unavailable" || c === "deadline-exceeded" || m.includes("network")) return "network";
  return "unknown";
}

function readFirebaseError(err: unknown): { code: string; message: string } {
  if (err && typeof err === "object") {
    const o = err as { code?: string; message?: string };
    return {
      code: typeof o.code === "string" ? o.code : "unknown",
      message: typeof o.message === "string" ? o.message : String(err),
    };
  }
  return { code: "unknown", message: String(err) };
}

export default function ClientDashboardPage() {
  const { user } = useAuth();
  const { tenant, role, clientId } = useTenant();
  const [clientName, setClientName] = useState<string>("");
  const [activeProjects, setActiveProjects] = useState<number>(0);
  const [unpaidInvoices, setUnpaidInvoices] = useState<number>(0);
  const [totalInvoices, setTotalInvoices] = useState<number>(0);
  const [recentActivity, setRecentActivity] = useState<RecentActivityItem[]>([]);
  const [clientServicesHealth, setClientServicesHealth] = useState<ClientServicesHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadFailure, setLoadFailure] = useState<LoadFailureDetail | null>(null);

  useEffect(() => {
    setError(null);
    setLoadFailure(null);
    const tenantId: string | undefined = tenant?.id;
    const clientIdStr: string | undefined = clientId;
    if (!user || !tenantId || role !== "client" || !clientIdStr) {
      setLoading(false);
      return;
    }

    const tid = tenantId as string;
    const cid = clientIdStr as string;

    async function load() {
      setLoading(true);
      setError(null);
      setLoadFailure(null);

      const ctx = { tenantId: tid, clientId: cid };

      const fail = (consoleLabel: string, section: string, err: unknown) => {
        const { code, message } = readFirebaseError(err);
        const classification = classifyFirebaseError(code, message);
        console.error(consoleLabel, {
          ...ctx,
          section,
          firebaseCode: code,
          firebaseMessage: message,
          classification,
          error: err,
        });
        setLoadFailure({ section, consoleLabel, code, message, classification });
        setError(`Dashboard load stopped at: ${section}`);
      };

      let resolvedClientName = "Client";
      try {
        console.log("CLIENT_DASHBOARD: running client document read", ctx);
        const clientDoc = await getDoc(doc(db, "tenants", tid, "clients", cid));
        resolvedClientName = (clientDoc.data()?.name as string) ?? "Client";
        setClientName(resolvedClientName);
      } catch (err) {
        fail("CLIENT_DASHBOARD: client document read failed", "client_document", err);
        setLoading(false);
        return;
      }

      let projectsSnap: Awaited<ReturnType<typeof getDocs>>;
      try {
        console.log("CLIENT_DASHBOARD: running projects query", ctx);
        projectsSnap = await getDocs(
          query(collection(db, "tenants", tid, "projects"), where("clientId", "==", cid))
        );
      } catch (err) {
        fail("CLIENT_DASHBOARD: projects query failed", "projects", err);
        setLoading(false);
        return;
      }
      const projects = projectsSnap.docs.map((d) => ({
        status: (d.data() as { status?: string }).status,
      }));
      setActiveProjects(projects.filter((p) => p.status === "active").length);

      let allSnap: Awaited<ReturnType<typeof getDocs>>;
      try {
        console.log("CLIENT_DASHBOARD: running invoices query (all for client)", ctx);
        allSnap = await getDocs(
          query(collection(db, "tenants", tid, "invoices"), where("clientId", "==", cid))
        );
      } catch (err) {
        fail("CLIENT_DASHBOARD: invoices query failed", "invoices_all", err);
        setLoading(false);
        return;
      }
      setTotalInvoices(allSnap.size);

      let unpaidSnap: Awaited<ReturnType<typeof getDocs>>;
      try {
        console.log("CLIENT_DASHBOARD: running invoices query (unpaid)", ctx);
        unpaidSnap = await getDocs(
          query(
            collection(db, "tenants", tid, "invoices"),
            where("clientId", "==", cid),
            where("status", "==", "unpaid")
          )
        );
      } catch (err) {
        fail("CLIENT_DASHBOARD: invoices unpaid query failed", "invoices_unpaid", err);
        setLoading(false);
        return;
      }
      setUnpaidInvoices(unpaidSnap.size);

      try {
        console.log("CLIENT_DASHBOARD: running subscriptions query (diagnostic)", ctx);
        await getDocs(
          query(collection(db, "tenants", tid, "subscriptions"), where("clientId", "==", cid))
        );
      } catch (err) {
        const subErr = readFirebaseError(err);
        console.error("CLIENT_DASHBOARD: subscriptions query failed", {
          ...ctx,
          firebaseCode: subErr.code,
          firebaseMessage: subErr.message,
          classification: classifyFirebaseError(subErr.code, subErr.message),
          error: err,
        });
        /* Non-blocking: dashboard did not load subscriptions before; rules may deny — check console. */
      }

      let allServicesForHealth: Awaited<ReturnType<typeof getDocs>>;
      try {
        console.log("CLIENT_DASHBOARD: running services query (health summary)", ctx);
        allServicesForHealth = await getDocs(
          query(collection(db, "tenants", tid, "services"), where("clientId", "==", cid))
        );
      } catch (err) {
        fail("CLIENT_DASHBOARD: services query failed", "services_health", err);
        setLoading(false);
        return;
      }

      const counts = {
        healthy: 0,
        warning: 0,
        critical: 0,
        waiting_client: 0,
      };
      type RowSort = ClientServiceHealthRow & { _due: number; _prio: number };
      const sortRows: RowSort[] = [];

      allServicesForHealth.forEach((d) => {
        const data = d.data() as {
          name?: string;
          health?: string;
          healthNote?: string;
          nextAction?: string;
          nextActionDue?: Timestamp | null;
          lastCheckedAt?: Timestamp | null;
          updatedAt?: Timestamp | null;
          createdAt?: Timestamp | null;
        };
        const bucket = clientDashboardHealthBucket(data.health);
        counts[bucket] += 1;

        let dueMs = Infinity;
        const due = data.nextActionDue;
        if (due && typeof due.toDate === "function") {
          try {
            dueMs = due.toDate().getTime();
          } catch {
            dueMs = Infinity;
          }
        }

        sortRows.push({
          id: d.id,
          name: data.name?.trim() ? data.name.trim() : "Your service",
          health: data.health ?? "",
          friendlyLine: getClientFriendlyHealthSummary(data.health),
          healthNote: data.healthNote?.trim() ? data.healthNote.trim() : undefined,
          nextAction: data.nextAction?.trim() ? data.nextAction.trim() : undefined,
          nextActionDueLabel: formatServiceDue(data.nextActionDue ?? null),
          lastCheckedLabel: formatLastChecked(
            data.lastCheckedAt ?? null,
            data.updatedAt ?? null,
            data.createdAt ?? null
          ),
          _due: dueMs,
          _prio: healthPreviewPriority(data.health),
        });
      });

      sortRows.sort((a, b) => {
        if (b._prio !== a._prio) return b._prio - a._prio;
        if (a._due !== b._due) return a._due - b._due;
        return a.name.localeCompare(b.name);
      });

      const services: ClientServiceHealthRow[] = sortRows.slice(0, 5).map(({ _due, _prio, ...rest }) => rest);

      setClientServicesHealth({
        counts,
        services,
        totalServices: sortRows.length,
      });

      let recentInvoicesSnap: Awaited<ReturnType<typeof getDocs>>;
      try {
        console.log("CLIENT_DASHBOARD: running recent activity invoices query", {
          ...ctx,
          query: "invoices where clientId + orderBy createdAt desc limit 6",
        });
        recentInvoicesSnap = await getDocs(
          query(
            collection(db, "tenants", tid, "invoices"),
            where("clientId", "==", cid),
            orderBy("createdAt", "desc"),
            limit(6)
          )
        );
      } catch (err) {
        fail("CLIENT_DASHBOARD: recent activity invoices query failed", "recent_activity_invoices", err);
        setLoading(false);
        return;
      }

      let recentServicesSnap: Awaited<ReturnType<typeof getDocs>>;
      try {
        console.log("CLIENT_DASHBOARD: running recent activity services query", {
          ...ctx,
          query: "services where clientId + orderBy updatedAt desc limit 6",
        });
        recentServicesSnap = await getDocs(
          query(
            collection(db, "tenants", tid, "services"),
            where("clientId", "==", cid),
            orderBy("updatedAt", "desc"),
            limit(6)
          )
        );
      } catch (err) {
        fail("CLIENT_DASHBOARD: recent activity services query failed", "recent_activity_services", err);
        setLoading(false);
        return;
      }

      const activity: RecentActivityItem[] = [];

      recentInvoicesSnap.forEach((d) => {
        const data = d.data() as {
          invoiceNumber?: string;
          amount?: number;
          currency?: string;
          createdAt?: { toDate?: () => Date };
        };
        const createdAt =
          data.createdAt && typeof data.createdAt.toDate === "function"
            ? data.createdAt.toDate()
            : undefined;
        activity.push({
          id: `inv_${d.id}`,
          title: data.invoiceNumber ? `Invoice ${data.invoiceNumber} generated` : "Invoice generated",
          subtitle:
            typeof data.amount === "number"
              ? `${data.currency ?? "USD"} ${data.amount.toLocaleString()}`
              : undefined,
          dateLabel: createdAt
            ? createdAt.toLocaleDateString(undefined, { month: "short", day: "numeric" })
            : "—",
          icon: "💸",
          timestamp: createdAt,
        });
      });

      recentServicesSnap.forEach((d) => {
        const data = d.data() as {
          name?: string;
          billingType?: string;
          subscriptionId?: string;
          createdAt?: { toDate?: () => Date };
          updatedAt?: { toDate?: () => Date };
        };
        const createdAt =
          data.createdAt && typeof data.createdAt.toDate === "function"
            ? data.createdAt.toDate()
            : undefined;
        const updatedAt =
          data.updatedAt && typeof data.updatedAt.toDate === "function"
            ? data.updatedAt.toDate()
            : createdAt;
        const bt = (data.billingType ?? "").toLowerCase();

        if (createdAt) {
          activity.push({
            id: `svc_${d.id}_created`,
            title: data.name ? `Service "${data.name}" created` : "Service created",
            subtitle: `Billing: ${getBillingTypeLabel(data.billingType)}`,
            dateLabel: createdAt.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
            icon: "🛠️",
            timestamp: createdAt,
          });
        }

        if (updatedAt && createdAt && updatedAt.getTime() - createdAt.getTime() > 2 * 60 * 1000) {
          activity.push({
            id: `svc_${d.id}_updated`,
            title: data.name ? `Service "${data.name}" updated` : "Service updated",
            subtitle: `Billing: ${getBillingTypeLabel(data.billingType)}`,
            dateLabel: updatedAt.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
            icon: "🧾",
            timestamp: updatedAt,
          });
        }

        if (updatedAt && bt === "recurring") {
          activity.push({
            id: `svc_${d.id}_recurring`,
            title: data.name ? `Service "${data.name}" set to Recurring` : "Service set to Recurring",
            subtitle: data.subscriptionId ? "Subscription linked" : undefined,
            dateLabel: updatedAt.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
            icon: "💳",
            timestamp: updatedAt,
          });
        }
      });

      const sorted = activity
        .slice()
        .sort((a, b) => (b.timestamp ? b.timestamp.getTime() : 0) - (a.timestamp ? a.timestamp.getTime() : 0))
        .slice(0, 15);
      setRecentActivity(sorted);

      setLoading(false);
    }

    load();
  }, [user, tenant?.id, role, clientId]);

  if (!user) return <p className="text-[#0F172A]">Please log in</p>;
  if (!tenant) return <p className="text-[#0F172A]">Loading tenant…</p>;
  if (role !== "client" || !clientId) return <p className="text-[#0F172A]">Access denied.</p>;
  if (loading) return <p className="text-[#0F172A]">Loading…</p>;
  if (error && loadFailure) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-rose-200 p-6 max-w-full overflow-hidden space-y-3">
        <p className="text-red-700 font-semibold">{error}</p>
        <div className="rounded-lg bg-slate-50 border border-slate-200 p-4 text-sm space-y-2 break-words">
          <p>
            <span className="text-slate-500">Failing section: </span>
            <span className="font-mono font-semibold text-[#0F172A]">{loadFailure.section}</span>
          </p>
          <p>
            <span className="text-slate-500">Console label: </span>
            <span className="font-mono text-xs text-slate-800">{loadFailure.consoleLabel}</span>
          </p>
          <p>
            <span className="text-slate-500">Firebase code: </span>
            <span className="font-mono text-rose-700">{loadFailure.code}</span>
          </p>
          <p>
            <span className="text-slate-500">Message: </span>
            <span className="text-slate-800">{loadFailure.message}</span>
          </p>
          <p>
            <span className="text-slate-500">Likely cause: </span>
            <span className="font-medium text-[#0F172A]">{loadFailure.classification}</span>
            {loadFailure.classification === "index" ? (
              <span className="text-slate-600"> (composite index or precondition — check Firebase console link in error)</span>
            ) : null}
            {loadFailure.classification === "permissions" ? (
              <span className="text-slate-600"> (Firestore security rules)</span>
            ) : null}
          </p>
        </div>
        <p className="text-xs text-slate-500">
          Open the browser devtools console and search for the label above for the full error object.
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <p className="text-red-600">{error}</p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-[#0F172A] text-2xl font-semibold">Dashboard</h1>
      <p className="text-slate-600 mt-1">{clientName}</p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <div className="text-xs uppercase tracking-wide text-slate-500">Active Projects</div>
          <div className="text-2xl font-semibold text-[#0F172A] mt-1">{activeProjects}</div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <div className="text-xs uppercase tracking-wide text-red-600">Unpaid Invoices</div>
          <div className="text-2xl font-semibold text-[#0F172A] mt-1">{unpaidInvoices}</div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <div className="text-xs uppercase tracking-wide text-slate-500">Total Invoices</div>
          <div className="text-2xl font-semibold text-[#0F172A] mt-1">{totalInvoices}</div>
        </div>
      </div>

      {clientServicesHealth && (
        <section className="mt-8 rounded-2xl border border-slate-200/90 bg-white shadow-sm overflow-hidden max-w-full">
          <div className="px-4 py-4 sm:px-6 sm:py-5 border-b border-slate-100 bg-gradient-to-r from-slate-50/90 to-indigo-50/40">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
              <div>
                <h2 className="text-[#0F172A] text-lg font-semibold tracking-tight">Your Services Health</h2>
                <p className="text-sm text-slate-600 mt-1 max-w-2xl leading-relaxed">
                  A quick read on how your managed services are doing. We keep this updated so you always know where
                  things stand — no jargon, no noise.
                </p>
              </div>
              <Link
                href="/client/services"
                className="inline-flex items-center justify-center rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-500 transition-colors shrink-0"
              >
                View all services
              </Link>
            </div>
          </div>

          <div className="p-4 sm:p-6 space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {(
                [
                  ["healthy", "Running smoothly", "Everything is running smoothly", "emerald"],
                  ["warning", "Monitoring", "We're monitoring a potential issue", "amber"],
                  ["critical", "Active support", "We're actively working on an issue", "rose"],
                  ["waiting_client", "Needs your input", "We need input from you", "indigo"],
                ] as const
              ).map(([key, shortLabel, longHint, tone]) => {
                const n = clientServicesHealth.counts[key];
                const ring =
                  tone === "emerald"
                    ? "ring-emerald-200/90 bg-emerald-50/80"
                    : tone === "amber"
                      ? "ring-amber-200/90 bg-amber-50/80"
                      : tone === "rose"
                        ? "ring-rose-200/90 bg-rose-50/80"
                        : "ring-indigo-200/90 bg-indigo-50/80";
                return (
                  <div
                    key={key}
                    className={`rounded-xl px-3 py-3 sm:py-4 shadow-sm ring-1 border border-white/70 ${ring} min-w-0`}
                  >
                    <p className="text-[11px] font-semibold text-slate-600 uppercase tracking-wide">{shortLabel}</p>
                    <p className="mt-1 text-2xl font-bold tabular-nums text-[#0F172A]">{n}</p>
                    <p className="mt-2 text-[11px] text-slate-600 leading-snug">{longHint}</p>
                  </div>
                );
              })}
            </div>

            <div>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
                <h3 className="text-sm font-semibold text-[#0F172A]">Your services</h3>
                <p className="text-xs text-slate-500">Up to five services, prioritized by what matters most.</p>
              </div>

              {clientServicesHealth.totalServices === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/90 px-4 py-8 text-center">
                  <p className="text-sm font-medium text-slate-700">No services to show yet</p>
                  <p className="text-xs text-slate-500 mt-2 max-w-md mx-auto leading-relaxed">
                    When your services are connected to this portal, you&apos;ll see status and next steps here.
                  </p>
                </div>
              ) : (
                <ul className="space-y-3">
                  {clientServicesHealth.services.map((row) => (
                    <li
                      key={row.id}
                      className={`rounded-xl border border-slate-100 border-l-4 pl-4 pr-3 py-3 sm:pl-5 sm:pr-4 sm:py-4 ${healthStatusAccentClass(row.health)}`}
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 flex-1 space-y-2">
                          <Link
                            href={`/client/services/${row.id}`}
                            className="text-base font-semibold text-[#0F172A] hover:text-indigo-700 transition-colors break-words"
                          >
                            {row.name}
                          </Link>
                          <p
                            className={`inline-flex max-w-full rounded-lg px-3 py-1.5 text-xs font-semibold leading-snug bg-white/80 border border-white/90 shadow-sm ${friendlyLineColorClass(row.health)}`}
                          >
                            {row.friendlyLine}
                          </p>
                          {row.healthNote ? (
                            <p className="text-sm text-slate-700 leading-relaxed break-words">{row.healthNote}</p>
                          ) : null}
                          <p className="text-xs text-slate-500">
                            Last checked:{" "}
                            <span className="font-medium text-slate-700">{row.lastCheckedLabel}</span>
                          </p>
                        </div>
                        <div className="shrink-0 w-full sm:w-auto sm:max-w-[42%] sm:text-right space-y-1">
                          {row.nextAction ? (
                            <>
                              <p className="text-[10px] uppercase tracking-wide text-slate-500">Next step</p>
                              <p className="text-sm font-medium text-[#0F172A] break-words">{row.nextAction}</p>
                            </>
                          ) : null}
                          {row.nextActionDueLabel !== "—" ? (
                            <p className="text-xs text-slate-600">
                              Target:{" "}
                              <span className="font-medium text-slate-800">{row.nextActionDueLabel}</span>
                            </p>
                          ) : null}
                          {!row.nextAction && row.nextActionDueLabel === "—" ? (
                            <p className="text-xs text-slate-500 sm:text-right">No scheduled next step right now.</p>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {clientServicesHealth.totalServices > 0 &&
              clientServicesHealth.counts.warning === 0 &&
              clientServicesHealth.counts.critical === 0 &&
              clientServicesHealth.counts.waiting_client === 0 ? (
                <div className="mt-5 rounded-xl border border-emerald-200/90 bg-emerald-50/80 px-4 py-4 sm:px-5">
                  <p className="text-sm font-semibold text-emerald-950">You&apos;re in a good place.</p>
                  <p className="text-sm text-emerald-900/90 mt-1 leading-relaxed">
                    All services are running smoothly from our side. If anything changes, we&apos;ll reflect it here.
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        </section>
      )}

      <div className="mt-6 flex flex-wrap gap-3">
        <Link
          href="/client/projects"
          className="inline-flex items-center px-4 py-2 rounded-lg bg-[#4F46E5] text-white font-medium hover:bg-indigo-600 transition-colors"
        >
          View Projects
        </Link>
        <Link
          href="/client/support"
          className="inline-flex items-center px-4 py-2 rounded-lg border border-slate-200 bg-white text-[#0F172A] font-medium hover:bg-slate-50 transition-colors"
        >
          Support Center
        </Link>
        <Link
          href="/client/support?new=1"
          className="inline-flex items-center px-4 py-2 rounded-lg border border-slate-200 bg-white text-[#0F172A] font-medium hover:bg-slate-50 transition-colors"
        >
          ➕ New Ticket
        </Link>
        <Link
          href="/client/invoices"
          className="inline-flex items-center px-4 py-2 rounded-lg border border-slate-200 bg-white text-[#0F172A] font-medium hover:bg-slate-50 transition-colors"
        >
          View Invoices
        </Link>
      </div>

      <div className="mt-8 bg-white rounded-2xl shadow-sm border border-slate-200 p-5 md:p-6 max-w-full">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-[#0F172A] font-semibold">Recent Activity</h2>
          <Link href="/client/services" className="text-sm text-indigo-600 hover:underline">
            View services
          </Link>
        </div>
        <div className="mt-4">
          {recentActivity.length ? (
            <div className="space-y-3">
              {recentActivity.map((item) => (
                <div key={item.id} className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center text-lg">
                    {item.icon}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-[#0F172A] break-words">{item.title}</p>
                      <p className="text-xs text-slate-500 whitespace-nowrap">{item.dateLabel}</p>
                    </div>
                    {item.subtitle ? (
                      <p className="text-xs text-slate-500 mt-1 break-words">{item.subtitle}</p>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-slate-50 border border-slate-100 rounded-xl p-4">
              <p className="text-sm text-slate-700">No recent activity yet.</p>
              <p className="text-xs text-slate-500 mt-1">
                When services, subscriptions, or invoices update, you’ll see it here.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
