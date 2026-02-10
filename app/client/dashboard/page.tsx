"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { collection, getDocs, query, where, doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/authContext";
import { useTenant } from "@/lib/tenantContext";

export default function ClientDashboardPage() {
  const { user } = useAuth();
  const { tenant, role, clientId } = useTenant();
  const [clientName, setClientName] = useState<string>("");
  const [activeProjects, setActiveProjects] = useState<number>(0);
  const [unpaidInvoices, setUnpaidInvoices] = useState<number>(0);
  const [totalInvoices, setTotalInvoices] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    if (!user || !tenant?.id || role !== "client" || !clientId) {
      setLoading(false);
      return;
    }

    async function load() {
      setLoading(true);
      try {
        const clientDoc = await getDoc(doc(db, "tenants", tenant.id, "clients", clientId));
        setClientName((clientDoc.data()?.name as string) ?? "Client");

        const projectsQuery = query(
          collection(db, "tenants", tenant.id, "projects"),
          where("clientId", "==", clientId)
        );
        const projectsSnap = await getDocs(projectsQuery);
        const projects = projectsSnap.docs.map((d) => ({ status: d.data().status }));
        setActiveProjects(projects.filter((p) => p.status === "active").length);

        const allInvoicesQuery = query(
          collection(db, "tenants", tenant.id, "invoices"),
          where("clientId", "==", clientId)
        );
        const unpaidQuery = query(
          collection(db, "tenants", tenant.id, "invoices"),
          where("clientId", "==", clientId),
          where("status", "==", "unpaid")
        );
        const [allSnap, unpaidSnap] = await Promise.all([
          getDocs(allInvoicesQuery),
          getDocs(unpaidQuery),
        ]);
        setTotalInvoices(allSnap.size);
        setUnpaidInvoices(unpaidSnap.size);
      } catch (err) {
        setError("Unable to load dashboard data. Please try again.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [user, tenant?.id, role, clientId]);

  if (!user) return <p className="text-[#0F172A]">Please log in</p>;
  if (!tenant) return <p className="text-[#0F172A]">Loading tenant…</p>;
  if (role !== "client" || !clientId) return <p className="text-[#0F172A]">Access denied.</p>;
  if (loading) return <p className="text-[#0F172A]">Loading…</p>;
  if (error) return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
      <p className="text-red-600">{error}</p>
    </div>
  );

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

      <div className="mt-6 flex gap-3">
        <Link
          href="/client/projects"
          className="inline-flex items-center px-4 py-2 rounded-lg bg-[#4F46E5] text-white font-medium hover:bg-indigo-600 transition-colors"
        >
          View Projects
        </Link>
        <Link
          href="/client/invoices"
          className="inline-flex items-center px-4 py-2 rounded-lg border border-slate-200 bg-white text-[#0F172A] font-medium hover:bg-slate-50 transition-colors"
        >
          View Invoices
        </Link>
      </div>
    </div>
  );
}
