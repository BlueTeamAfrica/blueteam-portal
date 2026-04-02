"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { doc, getDoc, Timestamp } from "firebase/firestore";
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

export default function ClientInvoiceDetailPage() {
  const params = useParams();
  const rawId = params?.invoiceId;
  const invoiceId =
    typeof rawId === "string" ? rawId : Array.isArray(rawId) ? rawId[0] : "";

  const { user } = useAuth();
  const { tenant, role, clientId } = useTenant();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  useEffect(() => {
    if (!user || !tenant?.id || role !== "client" || !clientId || !invoiceId) {
      setLoading(false);
      if (!invoiceId) setNotFound(true);
      return;
    }

    const tenantId = tenant.id;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setNotFound(false);
      try {
        const ref = doc(db, "tenants", tenantId, "invoices", invoiceId);
        const snap = await getDoc(ref);
        if (cancelled) return;
        if (!snap.exists()) {
          setNotFound(true);
          setInvoice(null);
          return;
        }
        const data = snap.data();
        if (data.clientId !== clientId) {
          setNotFound(true);
          setInvoice(null);
          return;
        }
        setInvoice({
          id: snap.id,
          invoiceNumber: data.invoiceNumber ?? data.number ?? snap.id,
          clientId: data.clientId,
          clientName: data.clientName,
          status: data.status,
          amount: typeof data.amount === "number" ? data.amount : undefined,
          currency: typeof data.currency === "string" ? data.currency : undefined,
          dueDate: data.dueDate,
        });
      } catch {
        if (!cancelled) setNotFound(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, tenant?.id, role, clientId, invoiceId]);

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

    setDownloadingPdf(true);
    try {
      const res = await fetch(`/api/invoices/${inv.id}/pdf`, {
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
      let filename = inv.invoiceNumber ?? "invoice";
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
      setDownloadingPdf(false);
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

  if (loading) return <p className="text-[#0F172A]">Loading invoice…</p>;

  if (notFound || !invoice) {
    return (
      <div className="max-w-full min-w-0">
        <h1 className="text-[#0F172A] text-2xl font-semibold">Invoice</h1>
        <div className="mt-6 bg-white rounded-xl shadow-sm border border-slate-200 p-8 text-center">
          <p className="text-slate-600">This invoice could not be found, or you do not have access.</p>
          <Link href="/client/invoices" className="inline-block mt-4 text-indigo-600 hover:underline font-medium">
            View all invoices
          </Link>
        </div>
      </div>
    );
  }

  const emphasis = getInvoiceEmphasis(invoice.status);
  const highlightUnpaid = isUnpaidOrOverdueInvoice(invoice.status);

  return (
    <div className="max-w-full min-w-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-[#0F172A] text-2xl font-semibold">Invoice</h1>
          <Link href="/client/invoices" className="inline-block mt-2 text-indigo-600 hover:underline text-sm py-1">
            ← All invoices
          </Link>
        </div>
      </div>

      <div
        id={`invoice-${invoice.id}`}
        className={`mt-6 rounded-2xl border p-6 shadow-sm max-w-2xl ${
          emphasis === "Unpaid"
            ? "border-rose-200 bg-rose-50/20"
            : emphasis === "Overdue"
              ? "border-amber-200 bg-amber-50/20"
              : "border-slate-200 bg-white"
        }`}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Invoice</p>
            <p className="text-xl font-semibold text-[#0F172A] break-words">{invoice.invoiceNumber ?? "—"}</p>
            {emphasis && highlightUnpaid ? (
              <p className="mt-2 text-sm font-semibold text-[#0F172A]">{emphasis}</p>
            ) : null}
          </div>
          <StatusBadge status={invoice.status} />
        </div>
        <p className="mt-4 text-2xl font-semibold text-[#0F172A] tabular-nums">{formatAmount(invoice)}</p>
        <dl className="mt-4 space-y-2 text-sm border-t border-slate-100 pt-4">
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500 shrink-0">Due date</dt>
            <dd className="font-medium text-[#0F172A] text-right">{formatDate(invoice.dueDate)}</dd>
          </div>
        </dl>
        <button
          type="button"
          disabled={downloadingPdf}
          onClick={() => downloadPdf(invoice)}
          className="mt-6 w-full sm:w-auto min-h-11 rounded-xl bg-[#4F46E5] px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {downloadingPdf ? "Downloading…" : "Download PDF"}
        </button>
        <p className="mt-3 text-xs text-slate-500">PDF downloads use your signed-in session (no link token required).</p>
      </div>
    </div>
  );
}
