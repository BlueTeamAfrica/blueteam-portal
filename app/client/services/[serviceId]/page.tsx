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

export default function ClientServiceDetailPage() {
  const { user } = useAuth();
  const { tenant, role, clientId } = useTenant();
  const params = useParams<{ serviceId?: string }>();
  const serviceId = params?.serviceId;

  const [service, setService] = useState<Service | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        <Link
          href={supportHref}
          className="inline-flex px-3 py-2 rounded-lg bg-[#4F46E5] text-white text-sm font-medium hover:bg-indigo-600 transition-colors"
        >
          Get support
        </Link>
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
            <p className="text-xs text-slate-500">Renewal date</p>
            <p className="mt-1 text-[#0F172A] font-medium">{formatDate(service.renewalDate)}</p>
          </div>
          <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
            <p className="text-xs text-slate-500">Linked project</p>
            <p className="mt-1 text-[#0F172A] font-medium break-words">{service.projectName ?? service.projectId ?? "—"}</p>
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
    </div>
  );
}

