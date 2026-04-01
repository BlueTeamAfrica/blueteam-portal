"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  Timestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/authContext";
import { useTenant } from "@/lib/tenantContext";
import { isCanonicalClientId } from "@/lib/canonicalClientId";
import { getManagedServiceCategoryLabel, getManagedServiceDisplayName } from "@/lib/serviceDisplayName";
import { PORTAL_SELECT_CLASS, PORTAL_SELECT_LABEL_CLASS } from "@/lib/portalSelectStyles";
import { SelectArrowWrap } from "@/components/portal/SelectArrowWrap";

type BillingType = "none" | "one_time" | "recurring";
type BillingInterval = "monthly" | "yearly";
type SubStatus = "active" | "paused" | "cancelled" | string;

type Service = {
  name?: string;
  category?: string;
  status?: string;
  description?: string;
  notes?: string;
  startDate?: Timestamp | null;
  billingType?: BillingType | string;
  price?: number;
  currency?: string;
  interval?: BillingInterval | string;
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
  categoryLabel?: string;
  clientId?: string;
  clientName?: string;
  projectId?: string;
  projectName?: string;
  subscriptionId?: string;
  updatedAt?: Timestamp;
  createdAt?: Timestamp;
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

function ServiceCategoryLine({ category, categoryLabel }: { category?: string; categoryLabel?: string }) {
  const line = getManagedServiceCategoryLabel(category, categoryLabel);
  if (!line) return null;
  return (
    <p className="text-sm text-slate-600 font-medium mt-1 break-words">
      <span className="text-slate-400 font-normal">Category · </span>
      {line}
    </p>
  );
}

function normalizeHealth(input: string) {
  const s = input.trim().toLowerCase();
  if (!s) return "";
  if (s === "healthy") return "healthy";
  if (s === "warning" || s === "warn") return "warning";
  if (s === "critical") return "critical";
  if (
    s === "waiting_client" ||
    s === "waiting client" ||
    s === "waiting-on-client" ||
    s === "waiting-on-client"
  )
    return "waiting_client";
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

function formatDateInputValue(ts?: Timestamp | null) {
  if (!ts) return "";
  const d = ts.toDate();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function addMonthsSafe(base: Date, months: number) {
  const year = base.getFullYear();
  const month = base.getMonth();
  const day = base.getDate();
  const target = new Date(year, month + months, 1, 12, 0, 0, 0);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, lastDay));
  return target;
}

function addYearsSafe(base: Date, years: number) {
  const target = new Date(base);
  target.setFullYear(base.getFullYear() + years);
  if (base.getMonth() === 1 && base.getDate() === 29 && target.getMonth() !== 1) {
    target.setMonth(1);
    target.setDate(28);
  }
  return target;
}

function computeNextBillingDate(startDate: Date, interval: BillingInterval) {
  if (interval === "yearly") return addYearsSafe(startDate, 1);
  return addMonthsSafe(startDate, 1);
}

function getBillingTypeLabel(v?: string) {
  const s = (v ?? "").toLowerCase();
  if (s === "none") return "Not billable";
  if (s === "one_time") return "One-time";
  if (s === "recurring") return "Recurring";
  return v ? v : "—";
}

function subscriptionStatusBadge(status?: SubStatus) {
  const s = (status ?? "").toLowerCase();
  const cls =
    s === "active"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : s === "paused"
        ? "bg-amber-50 text-amber-700 border-amber-200"
        : s
          ? "bg-slate-50 text-slate-700 border-slate-200"
          : "bg-slate-50 text-slate-600 border-slate-200";
  const label = s === "active" ? "Active" : s === "paused" ? "Paused" : s ? s : "—";
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${cls}`}>
      {label}
    </span>
  );
}

export default function PortalServiceDetailPage() {
  const { user } = useAuth();
  const { tenant, role } = useTenant();
  const params = useParams<{ serviceId?: string }>();
  const serviceId = params?.serviceId;

  const [service, setService] = useState<Service | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canEditHealth = role === "admin" || role === "owner";

  // Health editing state (portal admins/owners only)
  const [healthStatus, setHealthStatus] = useState<string>("healthy");
  const [healthNote, setHealthNote] = useState<string>("");
  const [nextAction, setNextAction] = useState<string>("");
  const [nextActionDueDate, setNextActionDueDate] = useState<string>("");
  const [operationalSummary, setOperationalSummary] = useState<string>("");
  const [healthUpdateLoading, setHealthUpdateLoading] = useState<boolean>(false);
  const [healthUpdateError, setHealthUpdateError] = useState<string | null>(null);

  // Billing editing state (portal admins/owners only)
  const canEditBilling = role === "admin" || role === "owner";
  const [billingType, setBillingType] = useState<BillingType>("none");
  const [billingPrice, setBillingPrice] = useState<string>("");
  const [billingCurrency, setBillingCurrency] = useState<string>("USD");
  const [billingInterval, setBillingInterval] = useState<BillingInterval>("monthly");
  const [billingStartDate, setBillingStartDate] = useState<string>("");
  const [billingNextDate, setBillingNextDate] = useState<string>("");
  const [billingUpdateLoading, setBillingUpdateLoading] = useState<boolean>(false);
  const [billingUpdateError, setBillingUpdateError] = useState<string | null>(null);
  const [linkedSub, setLinkedSub] = useState<{ id: string; status?: SubStatus; name?: string } | null>(null);

  const canManageClientLink = role === "admin" || role === "owner";
  type TenantClientRow = { id: string; name?: string; email?: string };
  const [tenantClients, setTenantClients] = useState<TenantClientRow[]>([]);
  const [repairClientId, setRepairClientId] = useState<string>("");
  const [clientLinkSaving, setClientLinkSaving] = useState(false);
  const [clientLinkError, setClientLinkError] = useState<string | null>(null);

  useEffect(() => {
    const tid = tenant?.id;
    if (!user || !tid || !serviceId) {
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
        setService(snap.data() as Service);
      } catch (e) {
        const err = e as { message?: string };
        setError(err.message ?? "Unable to load service.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [user, tenant?.id, serviceId]);

  useEffect(() => {
    const tid = tenant?.id;
    if (!user || !tid || !canManageClientLink) {
      setTenantClients([]);
      return;
    }
    let cancelled = false;
    async function loadClients() {
      try {
        const snap = await getDocs(collection(db, "tenants", tid as string, "clients"));
        if (cancelled) return;
        setTenantClients(
          snap.docs.map((d) => ({
            id: d.id,
            name: d.data().name as string | undefined,
            email: d.data().email as string | undefined,
          }))
        );
      } catch {
        if (!cancelled) setTenantClients([]);
      }
    }
    loadClients();
    return () => {
      cancelled = true;
    };
  }, [user, tenant?.id, canManageClientLink]);

  useEffect(() => {
    if (!service || tenantClients.length === 0) return;
    const current = service.clientId?.trim();
    if (current && tenantClients.some((c) => c.id === current)) {
      setRepairClientId(current);
      return;
    }
    setRepairClientId(tenantClients[0].id);
  }, [service?.clientId, tenantClients]);

  useEffect(() => {
    const tid = tenant?.id;
    const subId = service?.subscriptionId;
    if (!user || !tid || !subId) {
      setLinkedSub(null);
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
          setLinkedSub({ id: subscriptionId, status: "missing" });
          return;
        }
        const data = snap.data() as { status?: SubStatus; name?: string };
        setLinkedSub({ id: snap.id, status: data.status, name: data.name });
      } catch {
        if (!alive) return;
        setLinkedSub({ id: subscriptionId, status: "unknown" });
      }
    }
    loadSub();
    return () => {
      alive = false;
    };
  }, [service?.subscriptionId, tenant?.id, user]);

  useEffect(() => {
    if (!service) return;
    if (!canEditHealth) return;
    setHealthStatus(normalizeHealth(service.health ?? "") || "healthy");
    setHealthNote(service.healthNote ?? "");
    setNextAction(service.nextAction ?? "");
    setNextActionDueDate(formatDateInputValue(service.nextActionDue ?? null));
    setOperationalSummary(service.operationalSummary ?? "");
  }, [service, canEditHealth]);

  useEffect(() => {
    if (!service) return;
    if (!canEditBilling) return;
    const bt = (service.billingType ?? "one_time") as BillingType;
    if (bt === "recurring") setBillingType("recurring");
    else if (bt === "one_time") setBillingType("one_time");
    else setBillingType("none");
    setBillingPrice(typeof service.price === "number" ? String(service.price) : "");
    setBillingCurrency((service.currency ?? "USD").toUpperCase());
    const iv = (service.interval ?? "monthly") as BillingInterval;
    setBillingInterval(iv === "yearly" ? "yearly" : "monthly");
    setBillingStartDate(formatDateInputValue(service.startDate ?? null));
    setBillingNextDate(formatDateInputValue(service.nextBillingDate ?? null));
  }, [service, canEditBilling]);

  async function handleSaveClientLinkage(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setClientLinkSaving(true);
    setClientLinkError(null);
    try {
      const tid = tenant?.id;
      const sid = serviceId;
      if (!tid || !sid) {
        setClientLinkError("Missing tenant or service id.");
        return;
      }
      const picked = tenantClients.find((c) => c.id === repairClientId.trim());
      if (!picked || !isCanonicalClientId(picked.id)) {
        setClientLinkError("Choose a valid client from the list.");
        return;
      }
      const clientName = picked.name?.trim() ? picked.name.trim() : picked.email?.trim() ?? picked.id;
      const ref = doc(db, "tenants", tid, "services", sid);
      await updateDoc(ref, {
        clientId: picked.id,
        clientName,
        updatedAt: serverTimestamp(),
      });
      const snap = await getDoc(ref);
      if (snap.exists()) setService(snap.data() as Service);
    } catch (err) {
      setClientLinkError((err as { message?: string }).message ?? "Failed to update client linkage.");
    } finally {
      setClientLinkSaving(false);
    }
  }

  async function handleUpdateHealth(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setHealthUpdateLoading(true);
    setHealthUpdateError(null);
    try {
      const tid = tenant?.id;
      const sid = serviceId;
      if (!tid || !sid) {
        setHealthUpdateError("Missing tenant/service id.");
        return;
      }

      const ref = doc(db, "tenants", tid, "services", sid);
      const normalizedHealth = normalizeHealth(healthStatus) || "healthy";

      const nextActionDueTs = nextActionDueDate
        ? Timestamp.fromDate(new Date(`${nextActionDueDate}T12:00:00`))
        : null;

      await updateDoc(ref, {
        health: normalizedHealth,
        healthNote: healthNote.trim(),
        lastCheckedAt: serverTimestamp(),
        nextAction: nextAction.trim(),
        nextActionDue: nextActionDueTs,
        operationalSummary: operationalSummary.trim(),
      });

      const snap = await getDoc(ref);
      if (snap.exists()) setService(snap.data() as Service);
    } catch (err) {
      const msg = (err as { message?: string }).message ?? "Failed to update health.";
      setHealthUpdateError(msg);
    } finally {
      setHealthUpdateLoading(false);
    }
  }

  async function handleUpdateBilling(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBillingUpdateLoading(true);
    setBillingUpdateError(null);
    try {
      const tid = tenant?.id;
      const sid = serviceId;
      if (!tid || !sid) {
        setBillingUpdateError("Missing tenant/service id.");
        return;
      }
      const start = billingStartDate ? new Date(billingStartDate) : null;
      if (!start || Number.isNaN(start.getTime())) {
        setBillingUpdateError("Please provide a valid start date.");
        return;
      }

      const prevSubscriptionId = service?.subscriptionId ?? null;
      const priceNumber = billingPrice.trim() === "" ? null : Number.parseFloat(billingPrice);
      if (billingType === "recurring") {
        if (priceNumber == null || Number.isNaN(priceNumber) || priceNumber < 0) {
          setBillingUpdateError("Please provide a valid recurring price (0 or more).");
          return;
        }
        if (!billingCurrency.trim()) {
          setBillingUpdateError("Please provide a currency (e.g. USD).");
          return;
        }
      } else if (billingType === "none") {
        // Not billable: ignore price/currency/interval/next date.
      } else if (priceNumber != null && (Number.isNaN(priceNumber) || priceNumber < 0)) {
        setBillingUpdateError("Please provide a valid price (0 or more).");
        return;
      }

      const nextDate =
        billingType === "recurring"
          ? billingNextDate
            ? new Date(billingNextDate)
            : computeNextBillingDate(start, billingInterval)
          : null;
      if (nextDate && Number.isNaN(nextDate.getTime())) {
        setBillingUpdateError("Please provide a valid next billing date.");
        return;
      }

      if (billingType === "recurring" && !isCanonicalClientId(service?.clientId)) {
        setBillingUpdateError(
          "Set a client on this service before enabling recurring billing — clientId must match tenants/.../clients/{id} and the client user's users/{uid}.clientId."
        );
        return;
      }

      const svcRef = doc(db, "tenants", tid, "services", sid);

      await updateDoc(svcRef, {
        billingType,
        price: billingType === "none" ? null : priceNumber ?? null,
        currency:
          billingType === "none"
            ? null
            : billingCurrency.trim()
              ? billingCurrency.trim().toUpperCase()
              : null,
        interval: billingType === "recurring" ? billingInterval : null,
        startDate: Timestamp.fromDate(start),
        nextBillingDate: billingType === "recurring" && nextDate ? Timestamp.fromDate(nextDate) : null,
        subscriptionId: billingType === "recurring" ? (service?.subscriptionId ?? null) : null,
        updatedAt: serverTimestamp(),
      });

      if (billingType === "recurring") {
        const svcSnap = await getDoc(svcRef);
        const freshService = svcSnap.exists() ? (svcSnap.data() as Service) : undefined;
        const linkedId = freshService?.clientId;
        if (!freshService || !isCanonicalClientId(linkedId)) {
          setBillingUpdateError("Cannot sync subscription: service is missing a valid clientId.");
          return;
        }
        const existingSubId = freshService.subscriptionId;
        const effectiveNext = nextDate ?? computeNextBillingDate(start, billingInterval);
        const currency = billingCurrency.trim() ? billingCurrency.trim().toUpperCase() : "USD";
        const name = freshService?.name ?? "Service subscription";

        if (existingSubId) {
          await updateDoc(doc(db, "tenants", tid, "subscriptions", existingSubId), {
            serviceId: sid,
            clientId: linkedId,
            clientName: freshService?.clientName ?? null,
            name,
            price: priceNumber ?? 0,
            currency,
            interval: billingInterval,
            status: "active",
            startDate: Timestamp.fromDate(start),
            nextBillingDate: Timestamp.fromDate(effectiveNext),
            updatedAt: serverTimestamp(),
          });
        } else {
          const createdSub = await addDoc(collection(db, "tenants", tid, "subscriptions"), {
            serviceId: sid,
            clientId: linkedId,
            clientName: freshService?.clientName ?? null,
            name,
            price: priceNumber ?? 0,
            currency,
            interval: billingInterval,
            status: "active",
            startDate: Timestamp.fromDate(start),
            nextBillingDate: Timestamp.fromDate(effectiveNext),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            source: "service",
          });
          await updateDoc(svcRef, { subscriptionId: createdSub.id, updatedAt: serverTimestamp() });
        }
      } else if (prevSubscriptionId) {
        // Downgrade from recurring to one_time/none: pause the old subscription and unlink.
        await updateDoc(doc(db, "tenants", tid, "subscriptions", prevSubscriptionId), {
          status: "paused",
          updatedAt: serverTimestamp(),
        });
        await updateDoc(svcRef, { subscriptionId: null, updatedAt: serverTimestamp() });
      }

      const snap = await getDoc(svcRef);
      if (snap.exists()) setService(snap.data() as Service);
    } catch (err) {
      const msg = (err as { message?: string }).message ?? "Failed to update billing.";
      setBillingUpdateError(msg);
    } finally {
      setBillingUpdateLoading(false);
    }
  }

  const serviceDisplayTitle = service
    ? getManagedServiceDisplayName({
        name: service.name,
        category: service.category,
        categoryLabel: service.categoryLabel,
      })
    : "";
  const serviceCategoryLine = service
    ? getManagedServiceCategoryLabel(service.category, service.categoryLabel)
    : "";
  const showCategoryUnderTitle =
    Boolean(serviceCategoryLine) && serviceCategoryLine !== serviceDisplayTitle;

  const supportHref = useMemo(() => {
    const subject = serviceDisplayTitle
      ? `Service: ${serviceDisplayTitle} — Support request`
      : "Service support request";
    const descriptionParts: string[] = [];
    if (serviceId) descriptionParts.push(`Service ID: ${serviceId}`);
    if (service?.clientName) descriptionParts.push(`Client: ${service.clientName}`);
    if (service?.projectName) descriptionParts.push(`Project: ${service.projectName}`);
    const description = descriptionParts.join("\n");
    const qp = new URLSearchParams();
    qp.set("new", "1");
    qp.set("subject", subject);
    if (description) qp.set("description", description);
    qp.set("priority", "medium");
    if (service?.clientId) qp.set("clientId", service.clientId);
    if (service?.clientName) qp.set("clientName", service.clientName);
    if (service?.projectId) qp.set("projectId", service.projectId);
    if (service?.projectName) qp.set("projectName", service.projectName);
    return `/portal/support?${qp.toString()}`;
  }, [serviceDisplayTitle, service, serviceId]);

  if (!user) return <p className="text-[#0F172A]">Please log in</p>;
  if (!tenant) return <p className="text-[#0F172A]">Loading tenant…</p>;
  if (loading) return <p className="text-[#0F172A]">Loading service…</p>;
  if (notFound) {
    return (
      <div className="max-w-3xl">
        <h1 className="text-[#0F172A] text-xl sm:text-2xl font-semibold break-words">Service</h1>
        <div className="mt-4 bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <p className="text-slate-600">Service not found.</p>
          <Link href="/portal/services" className="inline-block mt-3 text-indigo-600 hover:underline text-sm">
            ← Back to services
          </Link>
        </div>
      </div>
    );
  }
  if (!service) return <p className="text-[#0F172A]">Service not found.</p>;

  return (
    <div className="max-w-full min-w-0">
      <Link href="/portal/services" className="inline-block text-indigo-600 hover:underline text-sm">
        ← Back to services
      </Link>

      <div className="mt-3 md:mt-4 bg-white rounded-2xl shadow-sm border border-slate-200 p-5 md:p-6 max-w-full">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[#0F172A] text-xl sm:text-2xl font-semibold break-words tracking-tight">
              {serviceDisplayTitle}
            </h1>
            {showCategoryUnderTitle ? (
              <ServiceCategoryLine category={service.category} categoryLabel={service.categoryLabel} />
            ) : null}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <StatusBadge status={service.status} />
              {service.tier ? (
                <span className="inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-100">
                  Tier: {service.tier}
                </span>
              ) : null}
            </div>
            <p className="mt-3 text-slate-600 text-sm break-words">
              {service.description ??
                service.notes ??
                "No description yet. Add `description` (or `notes`) to the service document to show a summary here."}
            </p>
            <p className="mt-3 text-xs text-slate-500 break-words">
              Last updated: {formatDateTime(service.updatedAt ?? service.createdAt)}
            </p>
          </div>

          <div className="flex flex-col sm:flex-row flex-wrap gap-2 shrink-0 w-full md:w-auto">
            <Link
              href={supportHref}
              className="inline-flex justify-center items-center px-4 py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-500 transition-colors shadow-sm"
            >
              Open support ticket
            </Link>
            <Link
              href="/portal/invoices"
              className="inline-flex justify-center items-center px-4 py-2.5 rounded-lg border border-slate-200 bg-white text-[#0F172A] text-sm font-medium hover:bg-slate-50 transition-colors"
            >
              Invoices
            </Link>
            <Link
              href="/portal/subscriptions"
              className="inline-flex justify-center items-center px-4 py-2.5 rounded-lg border border-slate-200 bg-white text-[#0F172A] text-sm font-medium hover:bg-slate-50 transition-colors"
            >
              Subscriptions
            </Link>
          </div>
        </div>
      </div>

      {error && (
        <div className="mt-4 bg-white rounded-xl shadow-sm border border-rose-200 p-4">
          <p className="text-rose-700 text-sm break-words">{error}</p>
        </div>
      )}

      {canManageClientLink && !isCanonicalClientId(service.clientId) ? (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/90 p-4 md:p-5 max-w-full">
          <p className="text-sm font-medium text-amber-950">Client portal linkage</p>
          {service.clientName?.trim() ? (
            <p className="mt-2 text-sm text-amber-900/90 leading-relaxed">
              This service has a client name on file but no{" "}
              <span className="font-mono text-xs bg-amber-100/80 px-1 rounded">clientId</span>. Client users only see
              services where{" "}
              <span className="font-mono text-xs bg-amber-100/80 px-1 rounded">service.clientId</span> matches{" "}
              <span className="font-mono text-xs bg-amber-100/80 px-1 rounded">users/&lt;uid&gt;.clientId</span> (the
              same id as <span className="font-mono text-xs bg-amber-100/80 px-1 rounded">clients/{"{"}id{"}"}</span>).
            </p>
          ) : (
            <p className="mt-2 text-sm text-amber-900/90 leading-relaxed">
              No <span className="font-mono text-xs bg-amber-100/80 px-1 rounded">clientId</span> on this service yet.
              Assign the canonical client record so the right portal user can see it.
            </p>
          )}
          {tenantClients.length === 0 ? (
            <p className="mt-3 text-xs text-amber-800">Add a client under Portal → Clients, then return here to link.</p>
          ) : (
            <form onSubmit={handleSaveClientLinkage} className="mt-4 flex flex-col space-y-3 sm:flex-row sm:space-y-0 sm:items-end sm:gap-3">
              <div className="space-y-1 flex-1 min-w-0">
                <label htmlFor="repair-client" className={PORTAL_SELECT_LABEL_CLASS}>
                  Link to client
                </label>
                <SelectArrowWrap>
                  <select
                    id="repair-client"
                    value={repairClientId}
                    onChange={(e) => setRepairClientId(e.target.value)}
                    className={PORTAL_SELECT_CLASS}
                  >
                    {tenantClients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name ?? c.email ?? c.id}
                      </option>
                    ))}
                  </select>
                </SelectArrowWrap>
              </div>
              <button
                type="submit"
                disabled={clientLinkSaving}
                className="px-4 py-2 rounded-lg bg-amber-800 text-white text-sm font-medium hover:bg-amber-900 disabled:opacity-60 shrink-0"
              >
                {clientLinkSaving ? "Saving…" : "Save client linkage"}
              </button>
            </form>
          )}
          {clientLinkError ? <p className="mt-2 text-sm text-rose-700 break-words">{clientLinkError}</p> : null}
        </div>
      ) : null}

      <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-4 max-w-full">
        <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-slate-200 p-5 md:p-6 max-w-full">
          <h2 className="text-[#0F172A] font-semibold">Service Overview</h2>
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
              <p className="text-xs text-slate-500">Start date</p>
              <p className="mt-1 text-[#0F172A] font-medium break-words">{formatDate(service.startDate ?? null)}</p>
            </div>
            <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
              <p className="text-xs text-slate-500">Renewal date</p>
              <p className="mt-1 text-[#0F172A] font-medium break-words">{formatDate(service.renewalDate)}</p>
            </div>
            <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
              <p className="text-xs text-slate-500">Plan / tier</p>
              <p className="mt-1 text-[#0F172A] font-medium break-words">{service.tier ?? "—"}</p>
            </div>
            <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
              <p className="text-xs text-slate-500">Linked client</p>
              <p className="mt-1 text-[#0F172A] font-medium break-words">{service.clientName ?? service.clientId ?? "—"}</p>
              {isCanonicalClientId(service.clientId) ? (
                <p className="mt-1 text-[11px] text-slate-500 font-mono break-all">clientId: {service.clientId}</p>
              ) : service.clientName?.trim() ? (
                <p className="mt-1 text-[11px] text-amber-800">Missing clientId — see warning above to fix.</p>
              ) : null}
            </div>
            <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
              <p className="text-xs text-slate-500">Linked project</p>
              <p className="mt-1 text-[#0F172A] font-medium break-words">{service.projectName ?? service.projectId ?? "No linked project"}</p>
            </div>
            <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 sm:col-span-2">
              <p className="text-xs text-slate-500">Notes</p>
              <p className="mt-1 text-sm text-[#0F172A] whitespace-pre-wrap break-words">{service.notes ?? "No notes yet."}</p>
            </div>
          </div>

          <div className="mt-6">
            <h3 className="text-[#0F172A] font-semibold">Recent activity</h3>
            <div className="mt-3 bg-slate-50 rounded-xl p-4 border border-slate-100">
              <p className="text-slate-600 text-sm break-words">
                V1 summary uses timestamps only. Add a `recentActivity` array to the service doc later to show check-ins, incidents, renewals, and notes.
              </p>
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-slate-500">Created</p>
                  <p className="text-sm text-[#0F172A]">{formatDateTime(service.createdAt)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Updated</p>
                  <p className="text-sm text-[#0F172A]">{formatDateTime(service.updatedAt)}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6">
            <h3 className="text-[#0F172A] font-semibold">Health</h3>
            <p className="mt-1 text-xs text-slate-600 max-w-2xl leading-relaxed">
              Status your team maintains for this engagement. Clients see a simplified, reassuring view in their portal
              — keep notes clear and actionable.
            </p>
            <div className="mt-3 bg-slate-50 rounded-xl p-4 sm:p-5 border border-slate-100 max-w-full overflow-hidden">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Status</span>
                <HealthBadge health={service.health} />
              </div>

              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <p className="text-xs text-slate-500">Health note</p>
                  <p className="mt-1 text-sm text-[#0F172A] whitespace-pre-wrap break-words">
                    {service.healthNote?.trim() ? service.healthNote : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Last checked</p>
                  <p className="text-sm text-[#0F172A] font-medium break-words">
                    {formatDateTime(service.lastCheckedAt ?? service.updatedAt ?? service.createdAt)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Next action</p>
                  <p className="text-sm text-[#0F172A] font-medium break-words">
                    {service.nextAction ?? "—"}
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    Due: {formatDate(service.nextActionDue ?? null)}
                  </p>
                </div>
              </div>

              <div className="mt-3 pt-3 border-t border-slate-200/80">
                <p className="text-xs text-slate-500">Operational summary</p>
                <p className="mt-1 text-sm text-slate-700 whitespace-pre-wrap break-words">
                  {service.operationalSummary ?? "—"}
                </p>
              </div>
            </div>

            {canEditHealth ? (
              <form onSubmit={handleUpdateHealth} className="mt-4">
                {healthUpdateError ? (
                  <div className="mb-3 bg-rose-50 border border-rose-200 rounded-xl p-3">
                    <p className="text-rose-700 text-sm break-words">{healthUpdateError}</p>
                  </div>
                ) : null}

                <div className="bg-white rounded-xl border border-slate-200 p-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="sm:col-span-2 space-y-1">
                      <label className={PORTAL_SELECT_LABEL_CLASS}>Health status</label>
                      <SelectArrowWrap>
                        <select
                          value={healthStatus}
                          onChange={(e) => setHealthStatus(e.target.value)}
                          className={PORTAL_SELECT_CLASS}
                        >
                          <option value="healthy">Healthy</option>
                          <option value="warning">Warning</option>
                          <option value="critical">Critical</option>
                          <option value="waiting_client">Waiting on Client</option>
                          <option value="paused">Paused</option>
                        </select>
                      </SelectArrowWrap>
                    </div>

                    <div className="sm:col-span-2">
                      <label className="block text-xs font-medium text-slate-600">Health note (optional)</label>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        Short context for your team (and optionally shown to clients). Saving sets <span className="font-medium">Last checked</span> to now.
                      </p>
                      <textarea
                        value={healthNote}
                        onChange={(e) => setHealthNote(e.target.value)}
                        rows={2}
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-indigo-200"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-600">Next action</label>
                      <input
                        type="text"
                        value={nextAction}
                        onChange={(e) => setNextAction(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-indigo-200"
                        placeholder="e.g. Complete access review"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-600">Next action due (optional)</label>
                      <input
                        type="date"
                        value={nextActionDueDate}
                        onChange={(e) => setNextActionDueDate(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-indigo-200"
                      />
                    </div>

                    <div className="sm:col-span-2">
                      <label className="block text-xs font-medium text-slate-600">Operational summary</label>
                      <textarea
                        value={operationalSummary}
                        onChange={(e) => setOperationalSummary(e.target.value)}
                        rows={3}
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-indigo-200"
                        placeholder="What is the current operational situation and what should be expected next?"
                      />
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-end gap-3">
                    <button
                      type="submit"
                      disabled={healthUpdateLoading}
                      className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 transition-colors disabled:opacity-70 disabled:cursor-not-allowed"
                    >
                      {healthUpdateLoading ? "Updating..." : "Update health"}
                    </button>
                  </div>
                </div>
              </form>
            ) : null}
          </div>

          <div className="mt-6">
            <h3 className="text-[#0F172A] font-semibold">Billing</h3>
            <div className="mt-3 bg-slate-50 rounded-xl p-4 border border-slate-100">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-slate-500">Billing type</p>
                  <p className="text-sm text-[#0F172A] font-medium break-words">
                    {getBillingTypeLabel(service.billingType)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Price</p>
                  <p className="text-sm text-[#0F172A] font-medium break-words">
                    {typeof service.price === "number" ? `${service.price.toLocaleString()}` : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Currency</p>
                  <p className="text-sm text-[#0F172A] font-medium break-words">{service.currency ?? "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Interval</p>
                  <p className="text-sm text-[#0F172A] font-medium break-words">{service.interval ?? "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Next billing date</p>
                  <p className="text-sm text-[#0F172A] font-medium break-words">
                    {formatDate(service.nextBillingDate ?? null)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Subscription status</p>
                  <div className="mt-1">{subscriptionStatusBadge(linkedSub?.status)}</div>
                </div>
              </div>
              <div className="mt-3 text-xs text-slate-500 break-words">
                Linked subscription:{" "}
                <span className="font-medium text-slate-700">{linkedSub?.name ?? service.subscriptionId ?? "—"}</span>
              </div>
              {service.subscriptionId ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link
                    href="/portal/subscriptions"
                    className="inline-flex px-3 py-2 rounded-lg bg-white border border-slate-200 text-[#0F172A] text-sm font-medium hover:bg-slate-50 transition-colors"
                  >
                    View subscription
                  </Link>
                </div>
              ) : null}
            </div>

            {canEditBilling ? (
              <form onSubmit={handleUpdateBilling} className="mt-4">
                {billingUpdateError ? (
                  <div className="mb-3 bg-rose-50 border border-rose-200 rounded-xl p-3">
                    <p className="text-rose-700 text-sm break-words">{billingUpdateError}</p>
                  </div>
                ) : null}

                <div className="bg-white rounded-xl border border-slate-200 p-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className={PORTAL_SELECT_LABEL_CLASS}>Billing type</label>
                      <SelectArrowWrap>
                        <select
                          value={billingType}
                          onChange={(e) => setBillingType(e.target.value as BillingType)}
                          className={PORTAL_SELECT_CLASS}
                        >
                          <option value="none">Not billable</option>
                          <option value="one_time">One-time</option>
                          <option value="recurring">Recurring</option>
                        </select>
                      </SelectArrowWrap>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-600">
                        Price {billingType === "recurring" ? "*" : "(optional)"}
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={billingPrice}
                        onChange={(e) => setBillingPrice(e.target.value)}
                        required={billingType === "recurring"}
                        disabled={billingType === "none"}
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-indigo-200"
                        placeholder="0.00"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-600">
                        Currency {billingType === "recurring" ? "*" : "(optional)"}
                      </label>
                      <input
                        type="text"
                        value={billingCurrency}
                        onChange={(e) => setBillingCurrency(e.target.value.toUpperCase())}
                        required={billingType === "recurring"}
                        disabled={billingType === "none"}
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-indigo-200"
                        placeholder="USD"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className={PORTAL_SELECT_LABEL_CLASS}>
                        Interval {billingType === "recurring" ? "*" : "(n/a)"}
                      </label>
                      <SelectArrowWrap>
                        <select
                          value={billingInterval}
                          onChange={(e) => setBillingInterval(e.target.value as BillingInterval)}
                          disabled={billingType !== "recurring"}
                          className={PORTAL_SELECT_CLASS}
                        >
                          <option value="monthly">Monthly</option>
                          <option value="yearly">Yearly</option>
                        </select>
                      </SelectArrowWrap>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-600">Start date *</label>
                      <input
                        type="date"
                        value={billingStartDate}
                        onChange={(e) => setBillingStartDate(e.target.value)}
                        required
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-indigo-200"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-600">
                        Next billing date {billingType === "recurring" ? "(optional)" : "(n/a)"}
                      </label>
                      <input
                        type="date"
                        value={billingNextDate}
                        onChange={(e) => setBillingNextDate(e.target.value)}
                        disabled={billingType !== "recurring"}
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:bg-slate-50 disabled:text-slate-400"
                      />
                      <p className="mt-1 text-xs text-slate-500">
                        Leave blank to auto-calculate from start date and interval.
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-end gap-3">
                    <button
                      type="submit"
                      disabled={billingUpdateLoading}
                      className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 transition-colors disabled:opacity-70 disabled:cursor-not-allowed"
                    >
                      {billingUpdateLoading ? "Saving..." : "Save billing"}
                    </button>
                  </div>
                </div>
              </form>
            ) : null}
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 md:p-6 max-w-full">
          <h2 className="text-[#0F172A] font-semibold">Shortcuts</h2>
          <div className="mt-4 space-y-2">
            <Link
              href={supportHref}
              className="block w-full text-center px-3 py-2 rounded-lg bg-[#4F46E5] text-white text-sm font-medium hover:bg-indigo-600 transition-colors"
            >
              Open support
            </Link>
            <Link
              href="/portal/clients"
              className="block w-full text-center px-3 py-2 rounded-lg border border-slate-200 bg-white text-[#0F172A] text-sm font-medium hover:bg-slate-50 transition-colors"
            >
              Go to client
            </Link>
            {service.projectId ? (
              <Link
                href={`/portal/projects/${service.projectId}`}
                className="block w-full text-center px-3 py-2 rounded-lg border border-slate-200 bg-white text-[#0F172A] text-sm font-medium hover:bg-slate-50 transition-colors"
              >
                Go to project
              </Link>
            ) : null}
            <Link
              href="/portal/invoices"
              className="block w-full text-center px-3 py-2 rounded-lg border border-slate-200 bg-white text-[#0F172A] text-sm font-medium hover:bg-slate-50 transition-colors"
            >
              View invoices
            </Link>
            <Link
              href="/portal/subscriptions"
              className="block w-full text-center px-3 py-2 rounded-lg border border-slate-200 bg-white text-[#0F172A] text-sm font-medium hover:bg-slate-50 transition-colors"
            >
              View subscriptions
            </Link>
            <button
              type="button"
              disabled
              className="block w-full text-center px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-slate-400 text-sm font-medium cursor-not-allowed"
            >
              Edit service (coming soon)
            </button>
            {service.subscriptionId ? (
              <div className="text-xs text-slate-500 break-words pt-2">
                Linked subscription: <span className="font-medium">{service.subscriptionId}</span>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

