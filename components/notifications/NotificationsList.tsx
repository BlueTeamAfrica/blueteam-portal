"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getDocs } from "firebase/firestore";
import { useAuth } from "@/lib/authContext";
import { formatRelativeTime, startOfTodayLocal } from "@/lib/formatRelativeTime";
import { markNotificationRead } from "@/lib/notificationsApi";
import { roleNotificationsFeedQuery, userNotificationsFeedQuery } from "@/lib/notificationsFirestore";

export type NotificationRow = {
  id: string;
  title: string;
  body: string;
  status: string;
  actionUrl?: string | null;
  createdAt?: { toDate: () => Date } | null;
};

function mergeFeeds(a: NotificationRow[], b: NotificationRow[]): NotificationRow[] {
  const map = new Map<string, NotificationRow>();
  for (const n of a) map.set(n.id, n);
  for (const n of b) map.set(n.id, n);
  return [...map.values()].sort((x, y) => {
    const tx = x.createdAt?.toDate?.()?.getTime() ?? 0;
    const ty = y.createdAt?.toDate?.()?.getTime() ?? 0;
    return ty - tx;
  });
}

export default function NotificationsList({
  tenantId,
  role,
  clientId,
}: {
  tenantId: string;
  role: string | undefined;
  clientId: string | undefined;
}) {
  const router = useRouter();
  const { user } = useAuth();
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!tenantId || !user) return;
    const uid = user.uid;
    const roleLower = (role ?? "").toLowerCase();
    setLoading(true);
    setError(null);
    try {
      const q1 = userNotificationsFeedQuery(tenantId, uid, 50);
      const q2 = roleNotificationsFeedQuery(tenantId, roleLower, clientId, 50);
      const [s1, s2] = await Promise.all([getDocs(q1), getDocs(q2)]);
      const rows1: NotificationRow[] = s1.docs.map((d) => {
        const x = d.data() as {
          title?: string;
          body?: string;
          status?: string;
          actionUrl?: string | null;
          createdAt?: { toDate: () => Date };
        };
        return {
          id: d.id,
          title: String(x.title ?? ""),
          body: String(x.body ?? ""),
          status: String(x.status ?? "unread"),
          actionUrl: x.actionUrl ?? null,
          createdAt: x.createdAt ?? null,
        };
      });
      const rows2: NotificationRow[] = s2.docs.map((d) => {
        const x = d.data() as {
          title?: string;
          body?: string;
          status?: string;
          actionUrl?: string | null;
          createdAt?: { toDate: () => Date };
        };
        return {
          id: d.id,
          title: String(x.title ?? ""),
          body: String(x.body ?? ""),
          status: String(x.status ?? "unread"),
          actionUrl: x.actionUrl ?? null,
          createdAt: x.createdAt ?? null,
        };
      });
      setItems(mergeFeeds(rows1, rows2));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load notifications");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [tenantId, user, role, clientId]);

  useEffect(() => {
    load();
  }, [load]);

  async function onRowClick(n: NotificationRow) {
    if (!user) return;
    if (n.status === "unread") {
      try {
        const token = await user.getIdToken();
        await markNotificationRead(token, tenantId, n.id);
        setItems((prev) =>
          prev.map((x) => (x.id === n.id ? { ...x, status: "read" } : x))
        );
      } catch {
        // navigate anyway
      }
    }
    if (n.actionUrl && n.actionUrl.startsWith("/")) {
      router.push(n.actionUrl);
    }
  }

  const startToday = startOfTodayLocal();
  const today: NotificationRow[] = [];
  const earlier: NotificationRow[] = [];
  for (const n of items) {
    const d = n.createdAt?.toDate?.() ?? null;
    if (d && d >= startToday) today.push(n);
    else earlier.push(n);
  }

  function Section({ title, rows }: { title: string; rows: NotificationRow[] }) {
    if (rows.length === 0) return null;
    return (
      <section className="mb-8">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">{title}</h2>
        <ul className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100 overflow-hidden">
          {rows.map((n) => {
            const unread = n.status === "unread";
            return (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => onRowClick(n)}
                  className={`w-full text-left px-4 py-3 transition-colors ${
                    unread ? "bg-indigo-50/40 border-l-4 border-indigo-500 pl-[calc(1rem-4px)]" : "hover:bg-slate-50"
                  }`}
                >
                  <div className="flex justify-between gap-3 items-start">
                    <span className={`text-sm font-medium ${unread ? "text-[#0F172A]" : "text-slate-800"}`}>
                      {n.title}
                    </span>
                    <span className="text-[11px] text-slate-400 shrink-0 whitespace-nowrap">
                      {formatRelativeTime(n.createdAt ?? null)}
                    </span>
                  </div>
                  <p className="text-sm text-slate-600 mt-1 line-clamp-3">{n.body}</p>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    );
  }

  if (loading) {
    return <p className="text-slate-600 text-sm">Loading notifications…</p>;
  }
  if (error) {
    return <p className="text-rose-600 text-sm">{error}</p>;
  }
  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 bg-white px-6 py-16 text-center">
        <p className="text-slate-800 font-medium">You&apos;re all caught up</p>
        <p className="text-slate-500 text-sm mt-2">No notifications yet. We&apos;ll let you know when something needs your attention.</p>
      </div>
    );
  }

  return (
    <>
      <Section title="Today" rows={today} />
      <Section title="Earlier" rows={earlier} />
    </>
  );
}
