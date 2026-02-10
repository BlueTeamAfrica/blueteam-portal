"use client";

import { useEffect, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/authContext";
import { useTenant } from "@/lib/tenantContext";

type Kpis = {
  totalClients: number;
  totalProjects: number;
  unpaidInvoices: number;
  unpaidInvoiceValue: number;
};

export default function PortalPage() {
  const { user } = useAuth();
  const { tenant } = useTenant();
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [loadingKpis, setLoadingKpis] = useState(true);

  useEffect(() => {
    if (!user || !tenant?.id) {
      setLoadingKpis(false);
      return;
    }

    async function loadKpis() {
      setLoadingKpis(true);
      try {
        // Total clients
        const clientsSnap = await getDocs(collection(db, "tenants", tenant.id, "clients"));
        const totalClients = clientsSnap.size;

        // Total projects
        const projectsSnap = await getDocs(collection(db, "tenants", tenant.id, "projects"));
        const totalProjects = projectsSnap.size;

        // Unpaid invoices (count + value)
        const unpaidQuery = query(
          collection(db, "tenants", tenant.id, "invoices"),
          where("status", "==", "unpaid")
        );
        const unpaidSnap = await getDocs(unpaidQuery);

        let unpaidInvoices = 0;
        let unpaidInvoiceValue = 0;
        unpaidSnap.forEach((doc) => {
          unpaidInvoices += 1;
          const data = doc.data() as { amount?: number };
          const amount = typeof data.amount === "number" ? data.amount : 0;
          unpaidInvoiceValue += amount;
        });

        setKpis({
          totalClients,
          totalProjects,
          unpaidInvoices,
          unpaidInvoiceValue,
        });
      } finally {
        setLoadingKpis(false);
      }
    }

    loadKpis();
  }, [user, tenant?.id]);

  if (!user) return <p className="text-[#0F172A]">Please log in</p>;
  if (!tenant) return <p className="text-[#0F172A]">Loading tenant…</p>;

  return (
    <div>
      <h1 className="text-[#0F172A] text-2xl font-semibold">Dashboard</h1>
      <p className="text-slate-600 mt-1">{tenant.name}</p>
      <p className="text-slate-500 text-sm">{tenant.status}</p>

      <div className="mt-6">
        {loadingKpis && <p className="text-[#0F172A]">Loading KPIs…</p>}
        {!loadingKpis && kpis && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
              <div className="text-xs uppercase tracking-wide text-slate-500">Total Clients</div>
              <div className="text-2xl font-semibold text-[#0F172A] mt-1">{kpis.totalClients}</div>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
              <div className="text-xs uppercase tracking-wide text-slate-500">Total Projects</div>
              <div className="text-2xl font-semibold text-[#0F172A] mt-1">{kpis.totalProjects}</div>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
              <div className="text-xs uppercase tracking-wide text-red-600">Unpaid Invoices</div>
              <div className="text-2xl font-semibold text-[#0F172A] mt-1">{kpis.unpaidInvoices}</div>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
              <div className="text-xs uppercase tracking-wide text-red-600">Unpaid Invoice Value</div>
              <div className="text-2xl font-semibold text-[#0F172A] mt-1">
                ${kpis.unpaidInvoiceValue.toLocaleString()}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
