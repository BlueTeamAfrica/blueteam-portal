"use client";

import { useEffect, useState } from "react";
import { collection, getDocs, addDoc, doc, updateDoc, serverTimestamp, Timestamp } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { useAuth } from "@/lib/authContext";
import { useTenant } from "@/lib/tenantContext";

type Client = { id: string; name?: string; email?: string; status?: string };
type Invoice = {
  id: string;
  invoiceNumber?: string;
  clientId?: string;
  clientName?: string;
  status?: string;
  amount?: number;
  currency?: string;
  dueDate?: Timestamp;
  notes?: string;
  source?: string;
};

export default function InvoicesPage() {
  const { user } = useAuth();
  const { tenant } = useTenant();
  const [clients, setClients] = useState<Client[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [formClientId, setFormClientId] = useState("");
  const [formAmount, setFormAmount] = useState("");
  const [formCurrency, setFormCurrency] = useState("USD");
  const [formDueDate, setFormDueDate] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Status update loading
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  // Generate due invoices
  const [generating, setGenerating] = useState(false);
  const [generateResult, setGenerateResult] = useState<{
    dueCount?: number;
    generatedCount?: number;
    skippedCount?: number;
    errorsCount?: number;
    errors?: Array<{ subscriptionId: string; message: string }>;
    isTestEmail?: boolean;
    email?:
      | {
          attempted: boolean;
          sentCount: number;
          failedCount: number;
          details?: Array<{ clientId: string; sent: boolean; to?: string; error?: string }>;
        }
      | {
          attempted: boolean;
          sent: boolean;
          to: string | null;
          error?: { message?: string; code?: unknown; response?: string | null; responseCode?: number | string | null } | null;
        };
  } | null>(null);

  const [sendingTestEmail, setSendingTestEmail] = useState(false);

  async function loadData() {
    if (!tenant?.id) return;
    setLoading(true);
    try {
      const [clientsSnap, invoicesSnap] = await Promise.all([
        getDocs(collection(db, "tenants", tenant.id, "clients")),
        getDocs(collection(db, "tenants", tenant.id, "invoices")),
      ]);
      setClients(
        clientsSnap.docs.map((d) => ({
          id: d.id,
          name: d.data().name,
          email: d.data().email,
          status: d.data().status,
        }))
      );
        setInvoices(
        invoicesSnap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            invoiceNumber: data.invoiceNumber ?? data.number ?? d.id,
            clientId: data.clientId,
            clientName: data.clientName,
            status: data.status,
            amount: typeof data.amount === "number" ? data.amount : undefined,
            currency: data.currency,
            dueDate: data.dueDate,
            notes: data.notes,
            source: data.source,
          };
        })
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!user || !tenant?.id) {
      setLoading(false);
      return;
    }
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, tenant?.id]);

  const getClientName = (inv: Invoice) => {
    if (inv.clientName) return inv.clientName;
    if (inv.clientId) {
      const client = clients.find((c) => c.id === inv.clientId);
      return client?.name ?? client?.email ?? inv.clientId;
    }
    return "—";
  };

  async function handleAddInvoice(e: React.FormEvent) {
    e.preventDefault();
    if (!tenant?.id) return;
    if (!formClientId || !formAmount || !formDueDate) return;

    const selectedClient = clients.find((c) => c.id === formClientId);
    const clientName = selectedClient?.name ?? selectedClient?.email ?? "";

    setSubmitting(true);
    try {
      const invoiceCount = invoices.length + 1;
      const invoiceNumber = `INV-${String(invoiceCount).padStart(4, "0")}`;

      await addDoc(collection(db, "tenants", tenant.id, "invoices"), {
        invoiceNumber,
        clientId: formClientId,
        clientName,
        amount: parseFloat(formAmount),
        currency: formCurrency,
        status: "unpaid",
        dueDate: Timestamp.fromDate(new Date(formDueDate)),
        notes: formNotes.trim() || null,
        createdAt: serverTimestamp(),
      });

      // Reset form
      setFormClientId("");
      setFormAmount("");
      setFormCurrency("USD");
      setFormDueDate("");
      setFormNotes("");
      setShowForm(false);

      // Refresh list
      await loadData();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSendTestEmail() {
    try {
      const defaultTo = "eldaby@toomahouse.com";
      const to = window.prompt("Send test email to:", defaultTo) || defaultTo;

      setSendingTestEmail(true);
      setGenerateResult(null);

      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error("Not logged in");

      const token = await currentUser.getIdToken();

      const res = await fetch("/api/admin/test-email", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ to }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to send test email");

      setGenerateResult({
        dueCount: 0,
        generatedCount: 0,
        skippedCount: 0,
        errorsCount: 0,
        isTestEmail: true,
        email: data.email,
      });
    } catch (err) {
      setGenerateResult({
        dueCount: 0,
        generatedCount: 0,
        skippedCount: 0,
        errorsCount: 0,
        isTestEmail: true,
        email: {
          attempted: true,
          sent: false,
          to: null,
          error: { message: err instanceof Error ? err.message : String(err), code: null, response: null, responseCode: null, command: null },
        },
      });
    } finally {
      setSendingTestEmail(false);
    }
  }

  async function handleGenerateDueInvoices() {
    if (!user || !tenant?.id) return;
    setGenerating(true);
    setGenerateResult(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/admin/generate-invoices", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ tenantId: tenant.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setGenerateResult({
          dueCount: 0,
          generatedCount: 0,
          skippedCount: 0,
          errorsCount: 1,
          errors: [{ subscriptionId: "", message: data.error ?? "Failed to generate invoices" }],
        });
        return;
      }
      setGenerateResult({
        dueCount: data.dueCount,
        generatedCount: data.generatedCount,
        skippedCount: data.skippedCount,
        errorsCount: data.errorsCount,
        errors: data.errors,
        email: data.email,
      });
      await loadData();
    } catch (err) {
      setGenerateResult({
        dueCount: 0,
        generatedCount: 0,
        skippedCount: 0,
        errorsCount: 1,
        errors: [{ subscriptionId: "", message: err instanceof Error ? err.message : "Failed to generate invoices" }],
      });
    } finally {
      setGenerating(false);
    }
  }

  function getInvoiceDisplayLabel(inv: Invoice): string {
    if (inv.source !== "subscription") return inv.invoiceNumber ?? "—";
    const num = inv.invoiceNumber ?? inv.id;
    const match = num.match(/_(\d{4}-\d{2})$/);
    if (match) return `SUB-${match[1]}`;
    return num;
  }

  async function handleToggleStatus(inv: Invoice) {
    if (!tenant?.id) return;
    const newStatus = inv.status === "paid" ? "unpaid" : "paid";
    setUpdatingId(inv.id);
    try {
      await updateDoc(doc(db, "tenants", tenant.id, "invoices", inv.id), {
        status: newStatus,
      });
      await loadData();
    } finally {
      setUpdatingId(null);
    }
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
    return (
      <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${styles}`}>
        {status ?? "—"}
      </span>
    );
  }

  function formatDate(ts?: Timestamp) {
    if (!ts) return "—";
    const d = ts.toDate();
    return d.toLocaleDateString();
  }

  if (!user) return <p className="text-[#0F172A]">Please log in</p>;
  if (!tenant) return <p className="text-[#0F172A]">Loading tenant…</p>;
  if (loading) return <p className="text-[#0F172A]">Loading invoices…</p>;

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-[#0F172A] text-2xl font-semibold">Invoices</h1>
        <div className="flex gap-2 flex-wrap">
          <button
            type="button"
            disabled={generating}
            onClick={handleGenerateDueInvoices}
            className="px-4 py-2 rounded-lg border border-slate-300 text-slate-800 font-medium hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {generating ? "Generating…" : "Generate Due Invoices"}
          </button>
          <div>
            <button
              type="button"
              disabled={sendingTestEmail}
              onClick={handleSendTestEmail}
              className="px-4 py-2 rounded-lg border border-slate-300 text-slate-800 font-medium hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {sendingTestEmail ? "Sending…" : "Send Test Email"}
            </button>
            <p className="text-xs text-slate-500 mt-0.5">Use for SMTP testing</p>
          </div>
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="px-4 py-2 rounded-lg bg-[#4F46E5] text-white font-medium hover:bg-indigo-600 transition-colors"
          >
            ➕ Add Invoice
          </button>
        </div>
      </div>

      {showForm && (
        <form
          onSubmit={handleAddInvoice}
          className="mt-6 bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-4"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[#0F172A] mb-1">Client *</label>
              <select
                value={formClientId}
                onChange={(e) => setFormClientId(e.target.value)}
                required
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-[#0F172A]"
              >
                <option value="">Select client</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name ?? c.email ?? c.id}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-[#0F172A] mb-1">Amount *</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={formAmount}
                onChange={(e) => setFormAmount(e.target.value)}
                required
                placeholder="0.00"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-[#0F172A] placeholder:text-slate-400"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#0F172A] mb-1">Currency</label>
              <select
                value={formCurrency}
                onChange={(e) => setFormCurrency(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-[#0F172A]"
              >
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="GBP">GBP</option>
                <option value="RWF">RWF</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-[#0F172A] mb-1">Due Date *</label>
              <input
                type="date"
                value={formDueDate}
                onChange={(e) => setFormDueDate(e.target.value)}
                required
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-[#0F172A]"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-[#0F172A] mb-1">Notes (optional)</label>
            <textarea
              value={formNotes}
              onChange={(e) => setFormNotes(e.target.value)}
              rows={2}
              placeholder="Additional notes…"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-[#0F172A] placeholder:text-slate-400 resize-none"
            />
          </div>
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium disabled:opacity-60 disabled:cursor-not-allowed hover:bg-emerald-700 transition-colors"
            >
              {submitting ? "Creating…" : "Create Invoice"}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-4 py-2 rounded-lg border border-slate-200 bg-white text-[#0F172A] font-medium hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="mt-6 bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <th className="text-left py-3 px-4 text-sm font-medium text-[#0F172A]">Invoice #</th>
              <th className="text-left py-3 px-4 text-sm font-medium text-[#0F172A]">Client</th>
              <th className="text-right py-3 px-4 text-sm font-medium text-[#0F172A]">Amount</th>
              <th className="text-left py-3 px-4 text-sm font-medium text-[#0F172A]">Due Date</th>
              <th className="text-left py-3 px-4 text-sm font-medium text-[#0F172A]">Status</th>
              <th className="text-right py-3 px-4 text-sm font-medium text-[#0F172A]">Actions</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => (
              <tr key={inv.id} className="border-b border-slate-100 last:border-0">
                <td className="py-3 px-4 text-[#0F172A]">
                  <div className="flex items-center gap-2">
                    <span>{getInvoiceDisplayLabel(inv)}</span>
                    {inv?.source === "subscription" ? (
                      <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 border border-blue-200">
                        Recurring
                      </span>
                    ) : (
                      <span className="rounded-full bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-600 border border-slate-200">
                        Manual
                      </span>
                    )}
                  </div>
                </td>
                <td className="py-3 px-4 text-[#0F172A]">{getClientName(inv)}</td>
                <td className="py-3 px-4 text-right text-[#0F172A]">
                  {inv.amount != null
                    ? `${inv.currency ?? "USD"} ${inv.amount.toLocaleString()}`
                    : "—"}
                </td>
                <td className="py-3 px-4 text-[#0F172A]">{formatDate(inv.dueDate)}</td>
                <td className="py-3 px-4">
                  <StatusBadge status={inv.status} />
                </td>
                <td className="py-3 px-4 text-right">
                  <button
                    type="button"
                    disabled={updatingId === inv.id}
                    onClick={() => handleToggleStatus(inv)}
                    className="text-sm text-[#4F46E5] hover:underline disabled:opacity-50"
                  >
                    {updatingId === inv.id
                      ? "Updating…"
                      : inv.status === "paid"
                        ? "Mark Unpaid"
                        : "Mark Paid"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {invoices.length === 0 && (
        <div className="mt-6 bg-white rounded-xl shadow-sm border border-slate-200 p-12 text-center">
          <p className="text-slate-500 text-lg">No invoices yet</p>
          <p className="text-slate-400 text-sm mt-1">Click &quot;Add Invoice&quot; to create your first invoice.</p>
        </div>
      )}

      {generateResult && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onClick={() => setGenerateResult(null)}
        >
          <div
            className="bg-white rounded-xl shadow-lg max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-[#0F172A] mb-4">
              {generateResult.isTestEmail ? "Send Test Email" : "Generate Due Invoices"}
            </h3>
            {generateResult.isTestEmail ? (
              <>
                {generateResult.email?.sent ? (
                  <p className="text-sm text-emerald-600">Test email sent to {generateResult.email.to ?? "owner"}</p>
                ) : (
                  <p className="text-sm text-red-600">
                    {generateResult.email?.error?.message ||
                      (generateResult.email?.error?.responseCode != null || generateResult.email?.error?.response
                        ? [generateResult.email?.error?.responseCode, generateResult.email?.error?.response]
                            .filter(Boolean)
                            .join(" ")
                        : null) ||
                      "Unknown error"}
                  </p>
                )}
              </>
            ) : (generateResult.generatedCount ?? 0) === 0 && (generateResult.errorsCount ?? 0) === 0 ? (
              <>
                <p className="text-slate-600">
                  {generateResult.dueCount === 0 ? "No new invoices due" : "No new invoices created (all already exist)"}
                </p>
                <p className="text-sm text-slate-500 mt-2">No email sent (no new invoices)</p>
              </>
            ) : (
              <div className="space-y-2 text-[#0F172A]">
                <p>Due: {generateResult.dueCount ?? 0}</p>
                <p>Generated: {generateResult.generatedCount ?? 0}</p>
                <p>Skipped: {generateResult.skippedCount ?? 0}</p>
                <p>Errors: {generateResult.errorsCount ?? 0}</p>
                {"sentCount" in (generateResult.email ?? {}) ? (
                  generateResult.email?.attempted ? (
                    <>
                      <p className="text-sm text-emerald-600">
                        Client emails sent: {(generateResult.email as { sentCount: number }).sentCount}
                      </p>
                      {(generateResult.email as { failedCount: number }).failedCount > 0 && (
                        <p className="text-sm text-red-600">
                          Client email failures: {(generateResult.email as { failedCount: number }).failedCount}
                          {((generateResult.email as { details?: Array<{ error?: string }> }).details?.find(
                            (d) => d.error
                          )?.error) && (
                            <> — {((generateResult.email as { details?: Array<{ error?: string }> }).details?.find((d) => d.error)?.error)}</>
                          )}
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="text-sm text-slate-500">No email sent (no new invoices)</p>
                  )
                ) : (
                  <p className="text-sm text-slate-500">No email sent (no new invoices)</p>
                )}
                {generateResult.errors?.length ? (
                  <div className="mt-4 p-3 bg-red-50 rounded-lg text-sm">
                    <p className="font-medium text-red-800">First error:</p>
                    <p className="text-red-700">{generateResult.errors[0].subscriptionId}</p>
                    <p className="text-red-700">{generateResult.errors[0].message}</p>
                  </div>
                ) : null}
              </div>
            )}
            <button
              type="button"
              onClick={() => setGenerateResult(null)}
              className="mt-6 w-full py-2 rounded-lg bg-[#4F46E5] text-white font-medium hover:bg-indigo-600"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
