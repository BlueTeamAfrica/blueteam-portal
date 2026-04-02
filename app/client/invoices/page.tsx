"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { collection, getDocs, query, where, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/authContext";
import { useTenant } from "@/lib/tenantContext";
import { getInvoiceEmphasis, isUnpaidOrOverdueInvoice } from "@/lib/clientPortalSignals";

type Invoice = {
  id: string;
  invoiceNumber?: string;
  clientId?: string;
  clientName?: string;
  status?: string;
  amount?: number;
  currency?: string;
  dueDate?: Timestamp;
};

function formatDate(ts?: Timestamp | null) {
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

  const label = getInvoiceEmphasis(status) ?? (status ?? "—");
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${styles}`}>
      {label}
    </span>
  );
}

export default function ClientInvoicesPage() {
  const { user } = useAuth();
  const { tenant, role, clientId } = useTenant();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloadingPdfId, setDownloadingPdfId] = useState<string | null>(null);

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
              currency: typeof data.currency === "string" ? data.currency : undefined,
              dueDate: data.dueDate,
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

  const mobileInvoices = useMemo(() => {
    const copy = invoices.slice();
    copy.sort((a, b) => {
      const aP = isUnpaidOrOverdueInvoice(a.status) ? 0 : 1;
      const bP = isUnpaidOrOverdueInvoice(b.status) ? 0 : 1;
      if (aP !== bP) return aP - bP;
      return 0;
    });
    return copy;
  }, [invoices]);

  const downloadPdf = async (inv: Invoice) => {
    if (!user) {
      alert("Please log in to download the PDF.");
      return;
    }
    const idToken = await user.getIdToken();
    if (!idToken) {
      alert("Please log in again to download the PDF.");
      return;
    }

    const invoiceId = inv.id || (inv as { invoiceId?: string }).invoiceId || (inv as { docId?: string }).docId;
    if (!invoiceId) {
      alert("Missing invoice id on this row.");
      return;
    }

    setDownloadingPdfId(inv.id);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/pdf`, {
        method: "GET",
        headers: { Authorization: `Bearer ${idToken}` },
      });

      if (!res.ok) {
        const contentType = res.headers.get("content-type") || "";
        let message = "PDF download failed.";
        if (contentType.includes("application/json")) {
          try {
            const data = await res.json();
            message = (data && typeof data.error === "string") ? data.error : message;
          } catch {
            message = await res.text() || message;
          }
        } else {
          message = await res.text() || message;
        }
        alert(message);
        return;
      }

      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition");
      let filename = (inv as { number?: string }).number ?? inv.invoiceNumber ?? "invoice";
      if (typeof filename !== "string") filename = "invoice";
      if (!filename.toLowerCase().endsWith(".pdf")) filename += ".pdf";
      const match = disposition && /filename="?([^";\n]+)"?/.exec(disposition);
      if (match && match[1]) filename = match[1].trim();

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert("Download failed: " + (err instanceof Error ? err.message : "Network error"));
    } finally {
      setDownloadingPdfId(null);
    }
  };

  const formatAmount = (inv: Invoice) => {
    if (inv.amount == null) return "—";
    const cur = inv.currency ?? "USD";
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency: cur }).format(inv.amount);
    } catch {
      return `${cur} ${inv.amount.toLocaleString()}`;
    }
  };

  if (!user) return <p className="text-[#0F172A]">Please log in</p>;
  if (!tenant) return <p className="text-[#0F172A]">Loading tenant…</p>;
  if (role !== "client" || !clientId) return <p className="text-[#0F172A]">Access denied.</p>;
  if (loading) return <p className="text-[#0F172A]">Loading invoices…</p>;
  if (error) return (
    <div className="max-w-full min-w-0">
      <h1 className="text-[#0F172A] text-2xl font-semibold">Invoices</h1>
      <div className="mt-6 bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <p className="text-red-600">{error}</p>
      </div>
    </div>
  );

  return (
    <div className="max-w-full min-w-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-[#0F172A] text-2xl font-semibold">Invoices</h1>
          <Link href="/client/dashboard" className="inline-block mt-2 text-indigo-600 hover:underline text-sm py-1">
            ← Back to dashboard
          </Link>
        </div>
      </div>

      {invoices.length === 0 ? (
        <div className="mt-6 bg-white rounded-xl shadow-sm border border-slate-200 p-8 md:p-12 text-center">
          <p className="text-slate-500 text-lg">No invoices yet</p>
          <p className="text-slate-400 text-sm mt-1">Your invoices will appear here when they are issued.</p>
        </div>
      ) : (
        <>
          {/* Mobile: stacked cards */}
          <ul className="mt-6 md:hidden space-y-3 list-none p-0 m-0">
            {mobileInvoices.map((inv) => {
              const emphasis = getInvoiceEmphasis(inv.status);
              return (
              <li
                key={inv.id}
                id={`invoice-${inv.id}`}
                className={`scroll-mt-24 rounded-2xl border p-4 shadow-sm min-w-0 ${
                  emphasis === "Unpaid"
                    ? "border-rose-200 bg-rose-50/20"
                    : emphasis === "Overdue"
                      ? "border-amber-200 bg-amber-50/20"
                      : "border-slate-200 bg-white"
                }`}
              >
                <div className="flex items-start justify-between gap-3 min-w-0">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Invoice</p>
                    <p className="text-lg font-semibold text-[#0F172A] truncate">{inv.invoiceNumber ?? "—"}</p>
                    {emphasis ? (
                      <p className="mt-2 text-sm font-semibold text-[#0F172A]">
                        {emphasis}
                      </p>
                    ) : null}
                    <p className="mt-2 text-2xl font-semibold text-[#0F172A] tabular-nums">{formatAmount(inv)}</p>
                  </div>
                  <StatusBadge status={inv.status} />
                </div>
                <dl className="mt-4 space-y-2 text-sm border-t border-slate-100 pt-4">
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500 shrink-0">Due date</dt>
                    <dd className="font-medium text-[#0F172A] text-right">{formatDate(inv.dueDate)}</dd>
                  </div>
                </dl>
                <button
                  type="button"
                  disabled={downloadingPdfId === inv.id}
                  onClick={() => downloadPdf(inv)}
                  className="mt-4 w-full min-h-11 rounded-xl bg-[#4F46E5] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {downloadingPdfId === inv.id ? "Downloading…" : "Download PDF"}
                </button>
              </li>
              );
            })}
          </ul>

          {/* Desktop: table */}
          <div className="mt-6 hidden md:block bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden max-w-full">
            <div className="w-full overflow-x-auto">
              <table className="min-w-[640px] w-full border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="text-left py-3 px-4 text-sm font-medium text-[#0F172A]">Invoice #</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-[#0F172A]">Status</th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-[#0F172A]">Amount</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-[#0F172A]">Due</th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-[#0F172A]">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => {
                    const emphasis = getInvoiceEmphasis(inv.status);
                    return (
                    <tr
                      key={inv.id}
                      id={`invoice-${inv.id}`}
                      className={`scroll-mt-24 border-b border-slate-100 last:border-0 ${
                        emphasis === "Unpaid"
                          ? "bg-rose-50/20"
                          : emphasis === "Overdue"
                            ? "bg-amber-50/20"
                            : ""
                      }`}
                    >
                      <td className="py-3 px-4 text-[#0F172A] font-medium">{inv.invoiceNumber ?? "—"}</td>
                      <td className="py-3 px-4">
                        <StatusBadge status={inv.status} />
                      </td>
                      <td className="py-3 px-4 text-right text-[#0F172A] tabular-nums">{formatAmount(inv)}</td>
                      <td className="py-3 px-4 text-[#0F172A]">{formatDate(inv.dueDate)}</td>
                      <td className="py-3 px-4 text-right">
                        <button
                          type="button"
                          disabled={downloadingPdfId === inv.id}
                          className="text-indigo-600 hover:underline disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium py-2 px-1 min-h-11 inline-flex items-center justify-end"
                          onClick={() => downloadPdf(inv)}
                        >
                          {downloadingPdfId === inv.id ? "Downloading…" : "Download PDF"}
                        </button>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
