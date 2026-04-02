"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onSnapshot } from "firebase/firestore";
import { useAuth } from "@/lib/authContext";
import { formatRelativeTime } from "@/lib/formatRelativeTime";
import { markNotificationRead } from "@/lib/notificationsApi";
import { roleRecentUnreadQuery, userRecentUnreadQuery } from "@/lib/notificationsFirestore";
import { useNotificationUnreadCount } from "@/hooks/useNotificationUnreadCount";

export type NotificationBellPreview = {
  id: string;
  title: string;
  body: string;
  status: string;
  actionUrl?: string | null;
  createdAt?: { toDate: () => Date } | null;
};

function formatBadge(n: number): string {
  if (n > 9) return "9+";
  return String(n);
}

export default function NotificationBell({
  tenantId,
  role,
  clientId,
  listPath,
}: {
  tenantId: string;
  role: string | undefined;
  clientId: string | undefined;
  listPath: string;
}) {
  const router = useRouter();
  const { user } = useAuth();
  const unreadTotal = useNotificationUnreadCount(tenantId, role, clientId);
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<NotificationBellPreview[]>([]);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const previewStore = useRef<{ user: NotificationBellPreview[]; role: NotificationBellPreview[] }>({
    user: [],
    role: [],
  });

  useEffect(() => {
    if (!tenantId || !user) {
      setPreview([]);
      return;
    }
    const uid = user.uid;
    const roleLower = (role ?? "").toLowerCase();
    const q1 = userRecentUnreadQuery(tenantId, uid, 8);
    const q2 = roleRecentUnreadQuery(tenantId, roleLower, clientId, 8);

    function mapDoc(d: { id: string; data: () => Record<string, unknown> }): NotificationBellPreview {
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
        status: String(x.status ?? ""),
        actionUrl: x.actionUrl ?? null,
        createdAt: x.createdAt ?? null,
      };
    }

    function pushMerged() {
      const map = new Map<string, NotificationBellPreview>();
      for (const n of previewStore.current.user) map.set(n.id, n);
      for (const n of previewStore.current.role) map.set(n.id, n);
      const list = [...map.values()].sort((a, b) => {
        const ta = a.createdAt?.toDate?.()?.getTime() ?? 0;
        const tb = b.createdAt?.toDate?.()?.getTime() ?? 0;
        return tb - ta;
      });
      setPreview(list.slice(0, 5));
    }

    const unsub1 = onSnapshot(
      q1,
      (snap) => {
        previewStore.current.user = snap.docs.map((d) => mapDoc(d));
        pushMerged();
      },
      () => setPreview([])
    );

    const unsub2 = onSnapshot(
      q2,
      (snap) => {
        previewStore.current.role = snap.docs.map((d) => mapDoc(d));
        pushMerged();
      },
      () => {}
    );

    return () => {
      unsub1();
      unsub2();
    };
  }, [tenantId, user, role, clientId]);

  async function onRowClick(n: NotificationBellPreview) {
    if (!user) return;
    try {
      const token = await user.getIdToken();
      await markNotificationRead(token, tenantId, n.id);
    } catch {
      // Still navigate; user can retry from list page.
    }
    setOpen(false);
    if (n.actionUrl && n.actionUrl.startsWith("/")) {
      router.push(n.actionUrl);
    } else {
      router.push(listPath);
    }
  }

  return (
    <div className="relative shrink-0" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="relative p-2 rounded-lg text-[#0F172A] hover:bg-slate-100"
        aria-label="Notifications"
        aria-expanded={open}
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
          />
        </svg>
        {unreadTotal > 0 ? (
          <span className="absolute top-1 right-1 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-rose-500 text-white text-[10px] font-bold leading-none">
            {formatBadge(unreadTotal)}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 mt-1 w-[min(100vw-2rem,22rem)] rounded-xl border border-slate-200 bg-white shadow-lg z-[200] overflow-hidden">
          <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-[#0F172A]">Notifications</span>
            <Link
              href={listPath}
              className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
              onClick={() => setOpen(false)}
            >
              View all
            </Link>
          </div>
          <div className="max-h-[min(70vh,320px)] overflow-y-auto">
            {preview.length === 0 ? (
              <p className="px-3 py-6 text-sm text-slate-500 text-center">No unread notifications</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {preview.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => onRowClick(n)}
                      className="w-full text-left px-3 py-2.5 hover:bg-slate-50 transition-colors"
                    >
                      <div className="flex justify-between gap-2 items-start">
                        <span className="text-sm font-medium text-[#0F172A] line-clamp-2">{n.title}</span>
                        <span className="text-[11px] text-slate-400 shrink-0 whitespace-nowrap">
                          {formatRelativeTime(n.createdAt ?? null)}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 line-clamp-2 mt-0.5">{n.body}</p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
