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
  type QueryDocumentSnapshot,
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
import { getManagedServiceDisplayName } from "@/lib/serviceDisplayName";

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

function queryDocCreatedMs(d: QueryDocumentSnapshot): number {
  const data = d.data() as { createdAt?: { toDate?: () => Date } };
  try {
    const c = data.createdAt;
    if (c && typeof c.toDate === "function") return c.toDate().getTime();
  } catch {
    /* ignore */
  }
  return 0;
}

function queryDocUpdatedMs(d: QueryDocumentSnapshot): number {
  const data = d.data() as { updatedAt?: { toDate?: () => Date } };
  try {
    const u = data.updatedAt;
    if (u && typeof u.toDate === "function") return u.toDate().getTime();
  } catch {
    /* ignore */
  }
  return queryDocCreatedMs(d);
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
  const [waitingTicketsCount, setWaitingTicketsCount] = useState(0);
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
    const uid = user.uid;

    async function load() {
      setLoading(true);
      setError(null);
      setLoadFailure(null);

      const ctx = { tenantId: tid, clientId: cid };

      let clientIdOnUserDoc: string | undefined;
      try {
        const userProfileSnap = await getDoc(doc(db, "users", uid));
        clientIdOnUserDoc = userProfileSnap.data()?.clientId as string | undefined;
        console.log("CLIENT_DASHBOARD: user_vs_query_clientId (services use this filter)", {
          uid,
          usersDocPath: `users/${uid}`,
          clientIdOnUserDoc,
          clientIdUsedInQueries: cid,
          exactMatch: clientIdOnUserDoc === cid,
        });
      } catch (userReadErr) {
        console.warn("CLIENT_DASHBOARD: could not read users/{uid} for clientId cross-check", {
          uid,
          error: userReadErr,
        });
      }

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
        console.log("CLIENT_DASHBOARD: running services query (health summary)", {
          ...ctx,
          collectionPath: `tenants/${tid}/services`,
          filter: { field: "clientId", op: "==", value: cid },
        });
        allServicesForHealth = await getDocs(
          query(collection(db, "tenants", tid, "services"), where("clientId", "==", cid))
        );
      } catch (err) {
        fail("CLIENT_DASHBOARD: services query failed", "services_health", err);
        setLoading(false);
        return;
      }

      const serviceDocSummaries = allServicesForHealth.docs.map((d) => {
        const raw = d.data() as { clientId?: unknown; name?: unknown };
        return {
          docId: d.id,
          clientIdOnDoc: raw.clientId,
          name: raw.name,
        };
      });
      console.log("CLIENT_DASHBOARD: services_health Firestore snapshot", {
        tenantId: tid,
        clientIdFilter: cid,
        docsReturned: allServicesForHealth.size,
        documents: serviceDocSummaries,
      });
      if (allServicesForHealth.size === 0) {
        console.warn(
          "CLIENT_DASHBOARD: services_health_zero_docs — compare users/{uid}.clientId to each service's clientId in tenants/{tenantId}/services. Rules only return docs where resource.data.clientId == users/{uid}.clientId.",
          {
            uid,
            usersPathClientId: clientIdOnUserDoc,
            queryFilterClientId: cid,
            servicesCollection: `tenants/${tid}/services`,
          }
        );
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
          category?: string;
          categoryLabel?: string;
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

      try {
        const waitingSnap = await getDocs(
          query(
            collection(db, "tenants", tid, "tickets"),
            where("clientId", "==", cid),
            where("status", "==", "waiting_client")
          )
        );
        setWaitingTicketsCount(waitingSnap.size);
      } catch (ticketsErr) {
        console.warn("CLIENT_DASHBOARD: waiting_client tickets query failed (non-blocking)", {
          ...ctx,
          error: ticketsErr,
        });
        setWaitingTicketsCount(0);
      }

      let recentInvoiceDocs: QueryDocumentSnapshot[];
      try {
        console.log("CLIENT_DASHBOARD: running recent activity invoices query", {
          ...ctx,
          query: "invoices where clientId + orderBy createdAt desc limit 6",
        });
        const recentInvoicesSnap = await getDocs(
          query(
            collection(db, "tenants", tid, "invoices"),
            where("clientId", "==", cid),
            orderBy("createdAt", "desc"),
            limit(6)
          )
        );
        recentInvoiceDocs = recentInvoicesSnap.docs;
      } catch (err) {
        const { code } = readFirebaseError(err);
        if (code === "failed-precondition") {
          console.warn(
            "CLIENT_DASHBOARD: recent activity invoices — missing composite index or not deployed; using clientId-only fetch + in-memory sort",
            ctx
          );
          try {
            const allInv = await getDocs(
              query(collection(db, "tenants", tid, "invoices"), where("clientId", "==", cid))
            );
            recentInvoiceDocs = allInv.docs
              .slice()
              .sort((a, b) => queryDocCreatedMs(b) - queryDocCreatedMs(a))
              .slice(0, 6);
          } catch (fallbackErr) {
            fail("CLIENT_DASHBOARD: recent activity invoices query failed", "recent_activity_invoices", fallbackErr);
            setLoading(false);
            return;
          }
        } else {
          fail("CLIENT_DASHBOARD: recent activity invoices query failed", "recent_activity_invoices", err);
          setLoading(false);
          return;
        }
      }

      let recentServiceDocs: QueryDocumentSnapshot[];
      try {
        console.log("CLIENT_DASHBOARD: running recent activity services query", {
          ...ctx,
          query: "services where clientId + orderBy updatedAt desc limit 6",
        });
        const recentServicesSnap = await getDocs(
          query(
            collection(db, "tenants", tid, "services"),
            where("clientId", "==", cid),
            orderBy("updatedAt", "desc"),
            limit(6)
          )
        );
        recentServiceDocs = recentServicesSnap.docs;
      } catch (err) {
        const { code } = readFirebaseError(err);
        if (code === "failed-precondition") {
          console.warn(
            "CLIENT_DASHBOARD: recent activity services — missing composite index or not deployed; using clientId-only fetch + in-memory sort",
            ctx
          );
          try {
            const allSvc = await getDocs(
              query(collection(db, "tenants", tid, "services"), where("clientId", "==", cid))
            );
            recentServiceDocs = allSvc.docs
              .slice()
              .sort((a, b) => queryDocUpdatedMs(b) - queryDocUpdatedMs(a))
              .slice(0, 6);
          } catch (fallbackErr) {
            fail("CLIENT_DASHBOARD: recent activity services query failed", "recent_activity_services", fallbackErr);
            setLoading(false);
            return;
          }
        } else {
          fail("CLIENT_DASHBOARD: recent activity services query failed", "recent_activity_services", err);
          setLoading(false);
          return;
        }
      }

      const activity: RecentActivityItem[] = [];

      recentInvoiceDocs.forEach((d) => {
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

      recentServiceDocs.forEach((d) => {
        const data = d.data() as {
          name?: string;
          category?: string;
          categoryLabel?: string;
          billingType?: string;
          subscriptionId?: string;
          createdAt?: { toDate?: () => Date };
          updatedAt?: { toDate?: () => Date };
        };
        const svcTitle = getManagedServiceDisplayName({
          name: data.name,
          category: data.category,
          categoryLabel: data.categoryLabel,
        });
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
            title: `New service: ${svcTitle}`,
            subtitle: `Billing: ${getBillingTypeLabel(data.billingType)}`,
            dateLabel: createdAt.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
            icon: "🛠️",
            timestamp: createdAt,
          });
        }

        if (updatedAt && createdAt && updatedAt.getTime() - createdAt.getTime() > 2 * 60 * 1000) {
          activity.push({
            id: `svc_${d.id}_updated`,
            title: `Service updated: ${svcTitle}`,
            subtitle: `Billing: ${getBillingTypeLabel(data.billingType)}`,
            dateLabel: updatedAt.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
            icon: "🧾",
            timestamp: updatedAt,
          });
        }

        if (updatedAt && bt === "recurring") {
          activity.push({
            id: `svc_${d.id}_recurring`,
            title: `Recurring billing: ${svcTitle}`,
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

  const waitingServicesCount = clientServicesHealth?.counts.waiting_client ?? 0;
  const actionRows: { id: string; count: number; message: string; href: string; cta: string }[] = [];
  if (unpaidInvoices > 0) {
    actionRows.push({
      id: "invoices",
      count: unpaidInvoices,
      message: `${unpaidInvoices} unpaid invoice${unpaidInvoices === 1 ? "" : "s"}`,
      href: "/client/invoices",
      cta: "View invoices",
    });
  }
  if (waitingServicesCount > 0) {
    actionRows.push({
      id: "services",
      count: waitingServicesCount,
      message:
        waitingServicesCount === 1
          ? "1 service needs your input"
          : `${waitingServicesCount} services need your input`,
      href: "/client/services",
      cta: "View services",
    });
  }
  if (waitingTicketsCount > 0) {
    actionRows.push({
      id: "tickets",
      count: waitingTicketsCount,
      message:
        waitingTicketsCount === 1
          ? "1 ticket awaiting your reply"
          : `${waitingTicketsCount} tickets awaiting your reply`,
      href: "/client/support",
      cta: "Open support",
    });
  }

  return (
    <div className="min-w-0 max-w-full overflow-x-hidden">
      <h1 className="text-[#0F172A] text-2xl font-semibold">Dashboard</h1>
      <p className="text-slate-600 mt-1 break-words">{clientName}</p>

      <section
        className="mt-6 rounded-2xl border border-amber-200/80 bg-gradient-to-b from-amber-50/90 to-white shadow-sm overflow-hidden max-w-full min-w-0"
        aria-labelledby="action-required-heading"
      >
        <div className="px-4 py-3 sm:px-5 border-b border-amber-200/60 bg-amber-50/80">
          <h2 id="action-required-heading" className="text-[#0F172A] text-base font-semibold">
            Action Required
          </h2>
        </div>
        <div className="p-4 sm:p-5">
          {actionRows.length === 0 ? (
            <p className="text-sm text-slate-600 text-center sm:text-left py-2">
              Nothing needs your attention right now
            </p>
          ) : (
            <ul className="space-y-3 list-none p-0 m-0">
              {actionRows.map((row) => (
                <li key={row.id} className="min-w-0">
                  <Link
                    href={row.href}
                    aria-label={`${row.message}. ${row.cta}`}
                    className="flex flex-col gap-3 rounded-xl border border-slate-200/90 bg-white px-4 py-3.5 min-h-[3rem] shadow-sm hover:border-indigo-200 hover:bg-indigo-50/40 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4F46E5] focus-visible:ring-offset-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                  >
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <span
                        className="shrink-0 flex h-10 min-w-[2.5rem] items-center justify-center rounded-lg bg-amber-100 text-amber-950 text-base font-bold tabular-nums px-2"
                        aria-hidden
                      >
                        {row.count}
                      </span>
                      <span className="text-[#0F172A] font-medium text-sm sm:text-base leading-snug break-words min-w-0 pt-1.5 sm:pt-1">
                        {row.message}
                      </span>
                    </div>
                    <span className="w-full sm:w-auto shrink-0 inline-flex items-center justify-center min-h-11 rounded-xl bg-[#4F46E5] px-4 py-2.5 text-sm font-semibold text-white sm:min-h-0 sm:bg-transparent sm:text-indigo-600 sm:px-3 sm:py-2 sm:font-semibold sm:hover:underline">
                      {row.cta}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 min-w-0">
          <div className="text-xs uppercase tracking-wide text-slate-500">Active Projects</div>
          <div className="text-2xl font-semibold text-[#0F172A] mt-1">{activeProjects}</div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 min-w-0">
          <div className="text-xs uppercase tracking-wide text-red-600">Unpaid Invoices</div>
          <div className="text-2xl font-semibold text-[#0F172A] mt-1">{unpaidInvoices}</div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 min-w-0">
          <div className="text-xs uppercase tracking-wide text-slate-500">Total Invoices</div>
          <div className="text-2xl font-semibold text-[#0F172A] mt-1">{totalInvoices}</div>
        </div>
      </div>

      {clientServicesHealth && (
        <section className="mt-8 rounded-2xl border border-slate-200/90 bg-white shadow-sm overflow-hidden max-w-full min-w-0">
          <div className="px-4 py-4 sm:px-6 sm:py-5 border-b border-slate-100 bg-gradient-to-r from-slate-50/90 to-indigo-50/40">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 min-w-0">
              <div className="min-w-0">
                <h2 className="text-[#0F172A] text-lg font-semibold tracking-tight">Your services</h2>
                <p className="text-sm text-slate-600 mt-1 max-w-2xl leading-relaxed">
                  A simple snapshot of how your managed services are doing. We update this as our team works — plain
                  language, no guesswork. If we need something from you, you&apos;ll see it called out clearly.
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
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
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
                    <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">{shortLabel}</p>
                    <p className="mt-1 text-2xl font-bold tabular-nums text-[#0F172A]">{n}</p>
                    <p className="mt-2 text-xs text-slate-600 leading-snug">{longHint}</p>
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
                  <p className="text-sm font-medium text-slate-800">
                    You don&apos;t have active managed services yet.
                  </p>
                  <p className="text-xs text-slate-600 mt-2 max-w-md mx-auto leading-relaxed">
                    Once Blueteam starts managing your systems, you&apos;ll see live status, updates, and next steps
                    here.
                  </p>
                  <p className="text-xs text-slate-500 mt-3 max-w-md mx-auto leading-relaxed">
                    We&apos;ll keep this updated automatically — no action needed from you.
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
                              <p className="text-xs uppercase tracking-wide text-slate-500">Next step</p>
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
          New ticket
        </Link>
        <Link
          href="/client/invoices"
          className="inline-flex items-center px-4 py-2 rounded-lg border border-slate-200 bg-white text-[#0F172A] font-medium hover:bg-slate-50 transition-colors"
        >
          View Invoices
        </Link>
      </div>

      <div className="mt-8 bg-white rounded-2xl shadow-sm border border-slate-200 p-5 md:p-6 max-w-full min-w-0">
        <div className="flex items-center justify-between gap-4 min-w-0">
          <h2 className="text-[#0F172A] font-semibold min-w-0">Recent Activity</h2>
          <Link href="/client/services" className="text-sm text-indigo-600 hover:underline shrink-0">
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
                    <div className="flex items-center justify-between gap-3 min-w-0">
                      <p className="text-sm font-medium text-[#0F172A] min-w-0 break-words">{item.title}</p>
                      <p className="text-xs text-slate-500 whitespace-nowrap shrink-0">{item.dateLabel}</p>
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
              <p className="text-sm font-medium text-slate-800">You&apos;re all caught up for now.</p>
              <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
                When invoices are issued or your services change, we&apos;ll show a short timeline here so you never
                have to hunt for updates.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
