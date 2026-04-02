"use client";

import { useState } from "react";
import { useAuth } from "@/lib/authContext";
import { useTenant } from "@/lib/tenantContext";
import NotificationsList from "@/components/notifications/NotificationsList";
import { markAllNotificationsRead } from "@/lib/notificationsApi";

export default function ClientNotificationsPage() {
  const { tenant, role, clientId, loading } = useTenant();
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const tid = tenant?.id;

  async function markAll() {
    if (!user || !tid) return;
    setBusy(true);
    try {
      const token = await user.getIdToken();
      await markAllNotificationsRead(token, tid);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto">
        <p className="text-slate-600 text-sm">Loading…</p>
      </div>
    );
  }
  if (!tid) {
    return (
      <div className="max-w-2xl mx-auto">
        <p className="text-slate-600 text-sm">No tenant context.</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="text-2xl font-semibold text-[#0F172A]">Notifications</h1>
        <button
          type="button"
          onClick={markAll}
          disabled={busy}
          className="text-sm font-medium px-4 py-2 rounded-lg border border-slate-200 bg-white text-[#0F172A] hover:bg-slate-50 disabled:opacity-50"
        >
          {busy ? "Working…" : "Mark all as read"}
        </button>
      </div>
      <NotificationsList key={refreshKey} tenantId={tid} role={role} clientId={clientId} />
    </div>
  );
}
