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
  tier?: string;
  renewalDate?: Timestamp;
  clientId?: string;
  clientName?: string;
  projectId?: string;
  projectName?: string;
  subscriptionId?: string;
  updatedAt?: Timestamp;
  createdAt?: Timestamp;
};

function formatDateTime(ts?: Timestamp) {
  if (!ts) return "—";
  try {
    return ts.toDate().toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return "—";
  }
}

function formatDate(ts?: Timestamp) {
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

function CategoryBadge({ category }: { category?: string }) {
  if (!category) return <span className="text-slate-500">—</span>;
  return (
    <span className="inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700 capitalize">
      {category}
    </span>
  );
}

export default function PortalServiceDetailPage() {
  const { user } = useAuth();
  const { tenant } = useTenant();
  const params = useParams<{ serviceId?: string }>();
  const serviceId = params?.serviceId;

  const [service, setService] = useState<Service | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const supportHref = useMemo(() => {
    const subject = service?.name ? `Service: ${service.name} — Support request` : "Service support request";
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
  }, [service?.name, service?.clientId, service?.clientName, service?.projectId, service?.projectName, serviceId]);

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
            <h1 className="text-[#0F172A] text-xl sm:text-2xl font-semibold break-words">
              {service.name ?? "Service"}
            </h1>
            <div className="mt-2 flex flex-wrap gap-2">
              <StatusBadge status={service.status} />
              <CategoryBadge category={service.category} />
              {service.tier ? (
                <span className="inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700">
                  Tier: {service.tier}
                </span>
              ) : null}
            </div>
            <p className="mt-3 text-slate-600 text-sm break-words">
              {service.description ?? "No description yet. Add `description` to the service document to show a summary here."}
            </p>
            <p className="mt-3 text-xs text-slate-500 break-words">
              Last updated: {formatDateTime(service.updatedAt ?? service.createdAt)}
            </p>
          </div>

          <div className="flex flex-wrap gap-2 shrink-0">
            <Link
              href={supportHref}
              className="px-3 py-2 rounded-lg bg-[#4F46E5] text-white text-sm font-medium hover:bg-indigo-600 transition-colors"
            >
              Open support ticket
            </Link>
            <Link
              href="/portal/invoices"
              className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-[#0F172A] text-sm font-medium hover:bg-slate-50 transition-colors"
            >
              Invoices
            </Link>
            <Link
              href="/portal/subscriptions"
              className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-[#0F172A] text-sm font-medium hover:bg-slate-50 transition-colors"
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

      <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-4 max-w-full">
        <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-slate-200 p-5 md:p-6 max-w-full">
          <h2 className="text-[#0F172A] font-semibold">Service Overview</h2>
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
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
            </div>
            <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
              <p className="text-xs text-slate-500">Linked project</p>
              <p className="mt-1 text-[#0F172A] font-medium break-words">{service.projectName ?? service.projectId ?? "—"}</p>
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
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 md:p-6 max-w-full">
          <h2 className="text-[#0F172A] font-semibold">Shortcuts</h2>
          <div className="mt-4 space-y-2">
            <Link
              href={supportHref}
              className="block w-full text-center px-3 py-2 rounded-lg bg-[#4F46E5] text-white text-sm font-medium hover:bg-indigo-600 transition-colors"
            >
              Support Center
            </Link>
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

