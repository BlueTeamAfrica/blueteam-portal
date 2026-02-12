"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/authContext";
import { useTenant } from "@/lib/tenantContext";

type Invoice = {
  id: string;
  invoiceNumber?: string;
  clientId?: string;
  clientName?: string;
  status?: string;
  amount?: number;
};

export default function ClientInvoicesPage() {
  const { user } = useAuth();
  const { tenant, role, clientId } = useTenant();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    const tenantId = tenant?.id;
    if (!user || !tenantId || role !== "client" || !clientId) {
      setLoading(false);
      return;
    }

    async function load() {
      setLoading(true);
      try {
        const q = query(
          collection(db, "tenants", tenantId as string, "invoices"),
          where("clientId", "==", clientId)
        );
        const snap = await getDocs(q);
        setInvoices(
          snap.docs.map((d) => {
            const data = d.data();
            return {
              id: d.id,
              invoiceNumber: data.invoiceNumber ?? data.number ?? d.id,
              clientId: data.clientId,
              clientName: data.clientName,
              status: data.status,
              amount: typeof data.amount === "number" ? data.amount : undefined,
            };
          })
        );
      } catch {
        setError("Unable to load invoices. Please try again.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [user, tenant?.id, role, clientId]);

  const downloadPdf = async (inv: Invoice) => {
    const idToken = await user?.getIdToken();
    if (!idToken) return;

    const invoiceId = inv.id || (inv as { invoiceId?: string }).invoiceId || (inv as { docId?: string }).docId;
    if (!invoiceId) {
      alert("Missing invoice id on this row.");
      return;
    }

    const res = await fetch(`/api/invoices/${invoiceId}/pdf`, {
      headers: { Authorization: `Bearer ${idToken}` },
    });

    if (!res.ok) {
      const txt = await res.text();
      alert(`PDF download failed (${res.status}): ${txt}`);
      return;
    }

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(inv as { number?: string }).number ?? inv.invoiceNumber ?? "invoice"}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  };

  if (!user) return <p className="text-[#0F172A]">Please log in</p>;
  if (!tenant) return <p className="text-[#0F172A]">Loading tenant…</p>;
  if (role !== "client" || !clientId) return <p className="text-[#0F172A]">Access denied.</p>;
  if (loading) return <p className="text-[#0F172A]">Loading invoices…</p>;
  if (error) return (
    <div>
      <h1 className="text-[#0F172A] text-2xl font-semibold">Invoices</h1>
      <div className="mt-6 bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <p className="text-red-600">{error}</p>
      </div>
    </div>
  );

  function StatusBadge({ status }: { status?: string }) {
    const s = (status ?? "").toLowerCase();
    const styles =
      s === "paid"
        ? "bg-emerald-100 text-emerald-800"
        : s === "unpaid"
          ? "bg-red-100 text-red-800"
          : s === "overdue"
            ? "bg-amber-100 text-amber-800"
            : "bg-slate-100 text-slate-600";
    return (
      <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${styles}`}>
        {status ?? "—"}
      </span>
    );
  }

  return (
    <div>
      <h1 className="text-[#0F172A] text-2xl font-semibold">Invoices</h1>
      <Link href="/client/dashboard" className="inline-block mt-2 text-[#4F46E5] hover:underline text-sm">
        ← Back to dashboard
      </Link>

      {invoices.length === 0 ? (
        <div className="mt-6 bg-white rounded-xl shadow-sm border border-slate-200 p-12 text-center">
          <p className="text-slate-500 text-lg">No invoices yet</p>
          <p className="text-slate-400 text-sm mt-1">Your invoices will appear here when they are issued.</p>
        </div>
      ) : (
        <div className="mt-6 bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="text-left py-3 px-4 text-sm font-medium text-[#0F172A]">Invoice #</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-[#0F172A]">Status</th>
                <th className="text-right py-3 px-4 text-sm font-medium text-[#0F172A]">Amount</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id} className="border-b border-slate-100 last:border-0">
                  <td className="py-3 px-4 text-[#0F172A]">{inv.invoiceNumber ?? "—"}</td>
                  <td className="py-3 px-4">
                    <StatusBadge status={inv.status} />
                  </td>
                  <td className="py-3 px-4 text-right text-[#0F172A]">
                    {inv.amount != null ? `$${inv.amount.toLocaleString()}` : "—"}
                  </td>
                  <td className="text-right">
                    <button
                      type="button"
                      className="text-blue-600 hover:underline"
                      onClick={() => downloadPdf(inv)}
                    >
                      Download PDF
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
