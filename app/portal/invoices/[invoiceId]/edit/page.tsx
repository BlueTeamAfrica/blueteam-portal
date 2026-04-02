"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { doc, getDoc, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/authContext";
import { useTenant } from "@/lib/tenantContext";
import { PORTAL_SELECT_CLASS, PORTAL_SELECT_LABEL_CLASS } from "@/lib/portalSelectStyles";
import { SelectArrowWrap } from "@/components/portal/SelectArrowWrap";

function isAdminOrOwnerRole(role: string | undefined): boolean {
  const r = (role ?? "").trim().toLowerCase();
  return r === "admin" || r === "owner";
}

type LineItemRow = { description: string; amount: string; currency: string };

function tsToDateInput(ts?: Timestamp | { toDate?: () => Date } | null): string {
  if (!ts || typeof (ts as Timestamp).toDate !== "function") return "";
  try {
    const d = (ts as Timestamp).toDate();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  } catch {
    return "";
  }
}

export default function EditInvoicePage() {
  const params = useParams();
  const router = useRouter();
  const rawId = params?.invoiceId;
  const invoiceId =
    typeof rawId === "string" ? rawId : Array.isArray(rawId) ? rawId[0] : "";

  const { user } = useAuth();
  const { tenant, role, loading: tenantLoading } = useTenant();

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState("unpaid");
  const [currency, setCurrency] = useState("USD");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [issueDate, setIssueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineItemRow[]>([{ description: "", amount: "", currency: "" }]);

  const canEdit = isAdminOrOwnerRole(role);

  useEffect(() => {
    if (tenantLoading || !user || !tenant?.id || !invoiceId) {
      if (!tenantLoading && !invoiceId) setLoading(false);
      return;
    }
    if (!canEdit) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const ref = doc(db, "tenants", tenant.id, "invoices", invoiceId);
        const snap = await getDoc(ref);
        if (cancelled) return;
        if (!snap.exists()) {
          setNotFound(true);
          setLoading(false);
          return;
        }
        const data = snap.data();
        setInvoiceNumber(String(data.invoiceNumber ?? data.number ?? snap.id));
        setTitle(typeof data.title === "string" ? data.title : "");
        setStatus(String(data.status ?? "unpaid").toLowerCase());
        setCurrency(String(data.currency ?? "USD"));
        setAmount(typeof data.amount === "number" ? String(data.amount) : "");
        setDueDate(tsToDateInput(data.dueDate as Timestamp));
        setIssueDate(tsToDateInput(data.issueDate as Timestamp));
        setNotes(typeof data.notes === "string" ? data.notes : "");
        const li = data.lineItems as Array<{ description?: string; amount?: number; currency?: string }> | undefined;
        if (Array.isArray(li) && li.length > 0) {
          setLines(
            li.map((row) => ({
              description: String(row.description ?? ""),
              amount: typeof row.amount === "number" ? String(row.amount) : "",
              currency: String(row.currency ?? ""),
            }))
          );
        } else {
          setLines([{ description: "", amount: "", currency: "" }]);
        }
      } catch {
        if (!cancelled) setError("Failed to load invoice");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, tenant?.id, tenantLoading, invoiceId, canEdit]);

  function addLine() {
    setLines((prev) => [...prev, { description: "", amount: "", currency: "" }]);
  }

  function removeLine(i: number) {
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((_, j) => j !== i)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !tenant?.id || !invoiceId) return;

    const amountNum = Number.parseFloat(amount);
    if (!Number.isFinite(amountNum) || amountNum < 0) {
      setError("Enter a valid amount (0 or more).");
      return;
    }
    if (!dueDate) {
      setError("Due date is required.");
      return;
    }

    const linePayload = lines
      .filter((r) => r.description.trim())
      .map((r) => {
        const a = Number.parseFloat(r.amount);
        if (!Number.isFinite(a)) throw new Error("Each line item needs a valid amount");
        const o: { description: string; amount: number; currency?: string } = {
          description: r.description.trim(),
          amount: a,
        };
        if (r.currency.trim()) o.currency = r.currency.trim().toUpperCase();
        return o;
      });

    setSaving(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const body: Record<string, unknown> = {
        tenantId: tenant.id,
        invoiceNumber: invoiceNumber.trim(),
        status,
        currency: currency.trim().toUpperCase() || "USD",
        amount: amountNum,
        dueDate: new Date(dueDate + "T12:00:00").toISOString(),
        notes: notes.trim() || null,
        lineItems: linePayload,
      };
      if (title.trim()) body.title = title.trim();
      if (issueDate.trim()) body.issueDate = new Date(issueDate + "T12:00:00").toISOString();

      const res = await fetch(`/api/invoices/${encodeURIComponent(invoiceId)}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Save failed");
      }
      router.push("/portal/invoices");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (!user) return <p className="text-[#0F172A]">Please log in</p>;
  if (tenantLoading || !tenant) return <p className="text-[#0F172A]">Loading…</p>;
  if (!canEdit) {
    return (
      <div className="max-w-2xl">
        <p className="text-[#0F172A]">Only admins can edit invoices.</p>
        <Link href="/portal/invoices" className="text-indigo-600 text-sm mt-2 inline-block">
          ← Back to invoices
        </Link>
      </div>
    );
  }
  if (loading) return <p className="text-[#0F172A]">Loading invoice…</p>;
  if (notFound) {
    return (
      <div className="max-w-2xl">
        <p className="text-rose-600">Invoice not found</p>
        <Link href="/portal/invoices" className="text-indigo-600 text-sm mt-2 inline-block">
          ← Back to invoices
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-3xl min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="text-[#0F172A] text-xl sm:text-2xl font-semibold">Edit invoice</h1>
        <Link href="/portal/invoices" className="text-sm text-indigo-600 hover:text-indigo-700">
          ← Back to list
        </Link>
      </div>

      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 md:p-6 space-y-5"
      >
        {error ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div>
        ) : null}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-[#0F172A] mb-1">Invoice #</label>
            <input
              value={invoiceNumber}
              onChange={(e) => setInvoiceNumber(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-[#0F172A]"
              required
            />
          </div>
          <div className="space-y-1">
            <label className={PORTAL_SELECT_LABEL_CLASS}>Status</label>
            <SelectArrowWrap>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className={PORTAL_SELECT_CLASS}
              >
                <option value="unpaid">Unpaid</option>
                <option value="paid">Paid</option>
                <option value="overdue">Overdue</option>
                <option value="sent">Sent</option>
              </select>
            </SelectArrowWrap>
          </div>
          <div>
            <label className="block text-sm font-medium text-[#0F172A] mb-1">Title (optional)</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Subscription name"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-[#0F172A] placeholder:text-slate-400"
            />
          </div>
          <div className="space-y-1">
            <label className={PORTAL_SELECT_LABEL_CLASS}>Currency</label>
            <SelectArrowWrap>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className={PORTAL_SELECT_CLASS}
              >
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="GBP">GBP</option>
                <option value="RWF">RWF</option>
              </select>
            </SelectArrowWrap>
          </div>
          <div>
            <label className="block text-sm font-medium text-[#0F172A] mb-1">Amount (total) *</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-[#0F172A]"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[#0F172A] mb-1">Due date *</label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              required
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-[#0F172A]"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[#0F172A] mb-1">Issue date (optional)</label>
            <input
              type="date"
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-[#0F172A]"
            />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-[#0F172A]">Line items</label>
            <button
              type="button"
              onClick={addLine}
              className="text-sm text-indigo-600 hover:text-indigo-700 font-medium"
            >
              + Add line
            </button>
          </div>
          <div className="space-y-2">
            {lines.map((row, i) => (
              <div key={i} className="flex flex-wrap gap-2 items-end">
                <input
                  placeholder="Description"
                  value={row.description}
                  onChange={(e) => {
                    const v = e.target.value;
                    setLines((prev) => prev.map((r, j) => (j === i ? { ...r, description: v } : r)));
                  }}
                  className="flex-1 min-w-[140px] px-3 py-2 rounded-lg border border-slate-200 text-[#0F172A] text-sm"
                />
                <input
                  type="number"
                  step="0.01"
                  placeholder="Amount"
                  value={row.amount}
                  onChange={(e) => {
                    const v = e.target.value;
                    setLines((prev) => prev.map((r, j) => (j === i ? { ...r, amount: v } : r)));
                  }}
                  className="w-28 px-3 py-2 rounded-lg border border-slate-200 text-[#0F172A] text-sm tabular-nums"
                />
                <input
                  placeholder="Cur"
                  value={row.currency}
                  onChange={(e) => {
                    const v = e.target.value;
                    setLines((prev) => prev.map((r, j) => (j === i ? { ...r, currency: v } : r)));
                  }}
                  className="w-20 px-3 py-2 rounded-lg border border-slate-200 text-[#0F172A] text-sm uppercase"
                />
                <button
                  type="button"
                  onClick={() => removeLine(i)}
                  className="text-sm text-slate-500 hover:text-rose-600 px-2 py-2"
                  disabled={lines.length <= 1}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-500 mt-2">
            Leave lines empty to store only the total amount. Filled lines are saved to the invoice.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-[#0F172A] mb-1">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 rounded-lg border border-slate-200 text-[#0F172A] resize-none"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-[#4F46E5] text-white text-sm font-medium hover:bg-indigo-600 disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
          <Link
            href="/portal/invoices"
            className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-medium text-[#0F172A] hover:bg-slate-50"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
