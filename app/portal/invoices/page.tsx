"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, addDoc, doc, getDoc, updateDoc, serverTimestamp, Timestamp } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { useAuth } from "@/lib/authContext";
import { useTenant } from "@/lib/tenantContext";
import { getBillingPlanIdFromTenant } from "@/lib/tenantBillingPlan";
import { PORTAL_SELECT_CLASS, PORTAL_SELECT_LABEL_CLASS } from "@/lib/portalSelectStyles";
import { SelectArrowWrap } from "@/components/portal/SelectArrowWrap";

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

function isAdminOrOwnerRole(role: string | undefined): boolean {
  const r = (role ?? "").trim().toLowerCase();
  return r === "admin" || r === "owner";
}

export default function InvoicesPage() {
  const { user } = useAuth();
  const { tenant, role, loading: tenantCtxLoading } = useTenant();
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
  const [formError, setFormError] = useState<string | null>(null);

  // Status update loading
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [downloadingPdfId, setDownloadingPdfId] = useState<string | null>(null);

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

  /** Same document Firestore rules use: userTenants/{uid}_{tenantId}.role */
  const [membershipRoleFromUt, setMembershipRoleFromUt] = useState<string | undefined>(undefined);
  const isAdminOrOwner =
    isAdminOrOwnerRole(role) || isAdminOrOwnerRole(membershipRoleFromUt);
  const [invoiceCreateAllowed, setInvoiceCreateAllowed] = useState(false);
  const [invoicePermResolved, setInvoicePermResolved] = useState(false);

  const billingPlanId = useMemo(() => getBillingPlanIdFromTenant(tenant), [tenant]);

  useEffect(() => {
    if (!tenant?.id || !user?.uid) {
      setMembershipRoleFromUt(undefined);
      setInvoiceCreateAllowed(false);
      setInvoicePermResolved(false);
      return;
    }
    if (tenantCtxLoading) {
      return;
    }

    let alive = true;
    setInvoicePermResolved(false);

    const uid = user.uid;
    const tid = tenant.id;
    const planId = billingPlanId;

    (async () => {
      try {
        const utPath = `${uid}_${tid}`;
        const [userSnap, utSnap, permSnap] = await Promise.all([
          getDoc(doc(db, "users", uid)),
          getDoc(doc(db, "userTenants", utPath)),
          getDoc(doc(db, "tenants", tid, "planPermissions", planId)),
        ]);

        const userDocRole = userSnap.exists() ? userSnap.data()?.role : undefined;
        const utRoleRaw = utSnap.exists() ? utSnap.data()?.role : undefined;
        const utRole = typeof utRoleRaw === "string" ? utRoleRaw : undefined;
        const permData = permSnap.exists() ? permSnap.data() : null;
        const canInvoicesResolved = !permSnap.exists() || permData?.canInvoices !== false;
        const isAdminCtx = isAdminOrOwnerRole(role);
        const isAdminUt = isAdminOrOwnerRole(utRole);
        const isAdminCombined = isAdminCtx || isAdminUt;

        if (alive) {
          setMembershipRoleFromUt(utRole);
        }

        console.info("[portal/invoices][perm]", {
          uid,
          tenantId: tid,
          userTenantsDocPath: `userTenants/${utPath}`,
          userDocRoleFromUsersCollection: userDocRole,
          userTenantsDocExists: utSnap.exists(),
          membershipRoleFromUserTenants: utRole,
          tenantContextRole: role,
          isAdminOrOwnerFromContext: isAdminCtx,
          isAdminOrOwnerFromUserTenantsDoc: isAdminUt,
          isAdminOrOwnerCombined: isAdminCombined,
          billingPlanIdResolved: planId,
          planPermissionsDocPath: `tenants/${tid}/planPermissions/${planId}`,
          planPermissionsExists: permSnap.exists(),
          planPermissionsData: permData ?? null,
          canInvoicesField: permData && "canInvoices" in permData ? permData.canInvoices : "(no field)",
          canInvoicesResolvedForUi: canInvoicesResolved,
          tenantCtxLoading,
          finalUiCanUseAddInvoice:
            !tenantCtxLoading && isAdminCombined && canInvoicesResolved,
        });

        if (!alive) return;

        if (!isAdminCombined) {
          setInvoiceCreateAllowed(false);
          setInvoicePermResolved(true);
          return;
        }

        setInvoiceCreateAllowed(canInvoicesResolved);
        setInvoicePermResolved(true);
      } catch (e) {
        console.warn(
          "[portal/invoices][perm] permission snapshot read failed — failing open for Add Invoice UI; Firestore rules still enforce create",
          e
        );
        if (alive) {
          setInvoiceCreateAllowed(true);
          setInvoicePermResolved(true);
        }
      }
    })();

    return () => {
      alive = false;
    };
  }, [tenant, tenant?.id, user?.uid, billingPlanId, role, tenantCtxLoading]);

  const canUseAddInvoice =
    !tenantCtxLoading && isAdminOrOwner && invoicePermResolved && invoiceCreateAllowed;

  useEffect(() => {
    if (!invoicePermResolved) return;
    if (!canUseAddInvoice) setShowForm(false);
  }, [invoicePermResolved, canUseAddInvoice]);

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

    if (!canUseAddInvoice) {
      setFormError("Only admins can create invoices. If you are an admin, your plan may not include invoicing.");
      return;
    }

    setFormError(null);

    if (!formClientId.trim() || !formAmount.trim() || !formDueDate) {
      setFormError("Please select a client, amount, and due date.");
      return;
    }

    const amountNum = Number.parseFloat(formAmount);
    if (!Number.isFinite(amountNum) || amountNum < 0) {
      setFormError("Please enter a valid amount (0 or more).");
      return;
    }

    const selectedClient = clients.find((c) => c.id === formClientId.trim());
    if (!selectedClient) {
      setFormError("Selected client is no longer in the list. Refresh and try again.");
      return;
    }
    const clientName =
      selectedClient.name?.trim() || selectedClient.email?.trim() || selectedClient.id;

    const due = new Date(formDueDate);
    if (Number.isNaN(due.getTime())) {
      setFormError("Please enter a valid due date.");
      return;
    }

    setSubmitting(true);
    try {
      const invoiceCount = invoices.length + 1;
      const invoiceNumber = `INV-${String(invoiceCount).padStart(4, "0")}`;

      console.info("[portal/invoices][perm] addDoc submit", {
        uid: user?.uid,
        tenantId: tenant.id,
        canUseAddInvoice,
        tenantContextRole: role,
        membershipRoleFromUt,
        billingPlanId,
      });

      await addDoc(collection(db, "tenants", tenant.id, "invoices"), {
        invoiceNumber,
        clientId: formClientId.trim(),
        clientName,
        amount: amountNum,
        currency: formCurrency.trim().toUpperCase() || "USD",
        status: "unpaid",
        dueDate: Timestamp.fromDate(due),
        notes: formNotes.trim() ? formNotes.trim() : null,
        source: "manual",
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
    } catch (err) {
      const code = err && typeof err === "object" && "code" in err ? String((err as { code?: string }).code) : "";
      const message = err instanceof Error ? err.message : String(err);
      console.error("[portal/invoices][perm] addDoc failed", {
        code,
        message,
        uid: user?.uid,
        tenantId: tenant?.id,
        tenantContextRole: role,
        membershipRoleFromUt,
        billingPlanId,
        err,
      });
      setFormError(
        code === "permission-denied"
          ? "You don’t have permission to create invoices (check Firestore rules and plan permissions), or your role isn’t admin/owner."
          : `Could not create invoice: ${message}`
      );
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
          error: { message: err instanceof Error ? err.message : String(err), code: null, response: null, responseCode: null },
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
  if (tenantCtxLoading || !tenant) return <p className="text-[#0F172A]">Loading tenant…</p>;
  if (loading) return <p className="text-[#0F172A]">Loading invoices…</p>;

  const emptyInvoicesHint = (() => {
    if (!invoicePermResolved) return "Invoices you add or generate will appear here.";
    if (!isAdminOrOwner) return "Only admins can create invoices.";
    if (!invoiceCreateAllowed) return "Manual invoicing is not included in your current plan.";
    return "Click \"Add Invoice\" to create your first invoice.";
  })();

  return (
    <div className="max-w-full min-w-0">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 md:gap-4">
        <h1 className="text-[#0F172A] text-xl sm:text-2xl font-semibold break-words">Invoices</h1>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={generating}
            onClick={handleGenerateDueInvoices}
            className="px-3 py-2 sm:px-4 rounded-lg border border-slate-300 text-slate-800 text-sm font-medium hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
          >
            {generating ? "Generating…" : "Generate Due Invoices"}
          </button>
          <div className="flex flex-col">
            <button
              type="button"
              disabled={sendingTestEmail}
              onClick={handleSendTestEmail}
              className="px-3 py-2 sm:px-4 rounded-lg border border-slate-300 text-slate-800 text-sm font-medium hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
            >
              {sendingTestEmail ? "Sending…" : "Send Test Email"}
            </button>
            <p className="text-xs text-slate-500 mt-0.5">Use for SMTP testing</p>
          </div>
          {canUseAddInvoice ? (
            <button
              type="button"
              onClick={() => {
                setFormError(null);
                setShowForm((v) => !v);
              }}
              className="px-3 py-2 sm:px-4 rounded-lg bg-[#4F46E5] text-white text-sm font-medium hover:bg-indigo-600 transition-colors whitespace-nowrap"
            >
              ➕ Add Invoice
            </button>
          ) : null}
        </div>
      </div>

      {showForm && canUseAddInvoice ? (
        <form
          onSubmit={handleAddInvoice}
          className="mt-4 md:mt-6 bg-white rounded-xl shadow-sm border border-slate-200 p-4 md:p-6 space-y-4 max-w-full"
        >
          {formError ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800" role="alert">
              {formError}
            </div>
          ) : null}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className={PORTAL_SELECT_LABEL_CLASS}>Client *</label>
              <SelectArrowWrap>
                <select
                  value={formClientId}
                  onChange={(e) => setFormClientId(e.target.value)}
                  required
                  className={PORTAL_SELECT_CLASS}
                >
                  <option value="">Select client</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name ?? c.email ?? c.id}
                    </option>
                  ))}
                </select>
              </SelectArrowWrap>
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
            <div className="space-y-1">
              <label className={PORTAL_SELECT_LABEL_CLASS}>Currency</label>
              <SelectArrowWrap>
                <select
                  value={formCurrency}
                  onChange={(e) => setFormCurrency(e.target.value)}
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
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="px-3 py-2 sm:px-4 rounded-lg bg-emerald-600 text-white text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed hover:bg-emerald-700 transition-colors"
            >
              {submitting ? "Creating…" : "Create Invoice"}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-3 py-2 sm:px-4 rounded-lg border border-slate-200 bg-white text-[#0F172A] text-sm font-medium hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {invoices.length > 0 ? (
        <>
          <div className="mt-4 md:mt-6 md:hidden space-y-3">
            {invoices.map((inv) => (
              <div key={inv.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-[#0F172A]">{getInvoiceDisplayLabel(inv)}</p>
                    <p className="text-sm text-slate-600 mt-0.5">{getClientName(inv)}</p>
                  </div>
                  <StatusBadge status={inv.status} />
                </div>
                <div className="mt-3 flex justify-between text-sm">
                  <span className="text-slate-500">Amount</span>
                  <span className="font-semibold text-[#0F172A] tabular-nums">
                    {inv.amount != null ? `${inv.currency ?? "USD"} ${inv.amount.toLocaleString()}` : "—"}
                  </span>
                </div>
                <div className="mt-1 flex justify-between text-sm">
                  <span className="text-slate-500">Due</span>
                  <span className="text-[#0F172A]">{formatDate(inv.dueDate)}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
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
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={downloadingPdfId === inv.id}
                    className="flex-1 min-w-[120px] px-3 py-2 rounded-lg border border-slate-200 text-sm font-medium text-indigo-700 hover:bg-slate-50 disabled:opacity-50"
                    onClick={() => downloadPdf(inv)}
                  >
                    {downloadingPdfId === inv.id ? "Downloading…" : "Download PDF"}
                  </button>
                  <button
                    type="button"
                    disabled={updatingId === inv.id}
                    className="flex-1 min-w-[120px] px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-500 disabled:opacity-50"
                    onClick={() => handleToggleStatus(inv)}
                  >
                    {updatingId === inv.id
                      ? "…"
                      : inv.status === "paid"
                        ? "Mark unpaid"
                        : "Mark paid"}
                  </button>
                </div>
              </div>
            ))}
          </div>

      <div className="mt-4 md:mt-6 hidden md:block bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden max-w-full">
        <div className="w-full overflow-x-auto">
          <table className="min-w-[900px] w-full border-collapse">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <th className="text-left py-3 px-4 text-sm font-medium text-[#0F172A]">Invoice #</th>
              <th className="text-left py-3 px-4 text-sm font-medium text-[#0F172A]">Client</th>
              <th className="text-right py-3 px-4 text-sm font-medium text-[#0F172A]">Amount</th>
              <th className="text-left py-3 px-4 text-sm font-medium text-[#0F172A]">Due Date</th>
              <th className="text-left py-3 px-4 text-sm font-medium text-[#0F172A]">Status</th>
              <th className="text-right">Actions</th>
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
                <td className="text-right">
                  <button
                    type="button"
                    disabled={downloadingPdfId === inv.id}
                    className="text-blue-600 hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={() => downloadPdf(inv)}
                  >
                    {downloadingPdfId === inv.id ? "Downloading…" : "Download PDF"}
                  </button>
                  <button
                    type="button"
                    disabled={updatingId === inv.id}
                    onClick={() => handleToggleStatus(inv)}
                    className="ml-2 text-sm text-[#4F46E5] hover:underline disabled:opacity-50"
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
      </div>
        </>
      ) : null}
      {invoices.length === 0 && (
        <div className="mt-4 md:mt-6 bg-white rounded-xl shadow-sm border border-slate-200 p-6 md:p-12 text-center max-w-full">
          <p className="text-slate-500 text-lg">No invoices yet</p>
          <p className="text-slate-400 text-sm mt-1">{emptyInvoicesHint}</p>
        </div>
      )}

      {generateResult && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onClick={() => setGenerateResult(null)}
        >
          <div
            className="bg-white rounded-xl shadow-lg max-w-md w-full p-4 md:p-6 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-[#0F172A] mb-4">
              {generateResult.isTestEmail ? "Send Test Email" : "Generate Due Invoices"}
            </h3>
            {generateResult.isTestEmail ? (
              <>
                {"sent" in (generateResult.email ?? {}) && (generateResult.email as { sent: boolean }).sent ? (
                  <p className="text-sm text-emerald-600">Test email sent to {(generateResult.email as { to?: string | null }).to ?? "owner"}</p>
                ) : (
                  <p className="text-sm text-red-600">
                    {(generateResult.email as { error?: { message?: string; responseCode?: unknown; response?: string | null } })?.error?.message ||
                      ((generateResult.email as { error?: { responseCode?: unknown; response?: string | null } })?.error?.responseCode != null || (generateResult.email as { error?: { response?: string | null } })?.error?.response
                        ? [(generateResult.email as { error?: { responseCode?: unknown } })?.error?.responseCode, (generateResult.email as { error?: { response?: string | null } })?.error?.response]
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
