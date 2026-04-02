"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { signOut } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { useAuth } from "@/lib/authContext";
import { useUserProfile } from "@/lib/userProfileContext";
import { useTenant } from "@/lib/tenantContext";
import { collection, getDocs, query, where } from "firebase/firestore";
import { isWaitingClientHealth, isTicketReplyNeeded } from "@/lib/clientPortalSignals";
import NotificationBell from "@/components/notifications/NotificationBell";
import { useNotificationUnreadCount } from "@/hooks/useNotificationUnreadCount";

const nav = [
  { href: "/client/dashboard", label: "Dashboard" },
  { href: "/client/projects", label: "Projects" },
  { href: "/client/services", label: "Services" },
  { href: "/client/invoices", label: "Invoices" },
  { href: "/client/subscriptions", label: "Subscriptions" },
  { href: "/client/support", label: "Support" },
  { href: "/client/notifications", label: "Notifications" },
];

function NavLinks({
  pathname,
  onNavigate,
  servicesNeedsInputCount,
  invoicesUnpaidCount,
  invoicesOverdueCount,
  ticketsReplyNeededCount,
  notificationCount,
}: {
  pathname: string;
  onNavigate?: () => void;
  servicesNeedsInputCount: number;
  invoicesUnpaidCount: number;
  invoicesOverdueCount: number;
  ticketsReplyNeededCount: number;
  notificationCount: number;
}) {
  return (
    <>
      {nav.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          onClick={onNavigate}
          className={`block px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
            pathname === item.href
              ? "bg-indigo-50 text-[#4F46E5]"
              : "text-[#0F172A] hover:bg-slate-100"
          }`}
        >
          <span className="inline-flex items-center gap-2 min-w-0">
            <span className="truncate">{item.label}</span>
            {item.href === "/client/services" && servicesNeedsInputCount > 0 ? (
              <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                {servicesNeedsInputCount}
              </span>
            ) : null}
            {item.href === "/client/invoices" &&
            invoicesUnpaidCount + invoicesOverdueCount > 0 ? (
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold border ${
                  invoicesUnpaidCount > 0
                    ? "bg-rose-50 text-rose-800 border-rose-200"
                    : "bg-amber-50 text-amber-800 border-amber-200"
                }`}
              >
                {invoicesUnpaidCount + invoicesOverdueCount}
              </span>
            ) : null}
            {item.href === "/client/support" && ticketsReplyNeededCount > 0 ? (
              <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold bg-sky-50 text-sky-700 border border-sky-200">
                {ticketsReplyNeededCount}
              </span>
            ) : null}
            {item.href === "/client/notifications" && notificationCount > 0 ? (
              <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold bg-rose-50 text-rose-800 border border-rose-200">
                {notificationCount > 9 ? "9+" : notificationCount}
              </span>
            ) : null}
          </span>
        </Link>
      ))}
    </>
  );
}

const DRAWER_WIDTH_CLASS = "w-[82vw] max-w-[320px]";

export default function ClientLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, loading: authLoading } = useAuth();
  const { role, loading } = useUserProfile();
  const { tenant, clientId, role: tenantRole } = useTenant();
  const notificationCount = useNotificationUnreadCount(tenant?.id, tenantRole, clientId);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const [servicesNeedsInputCount, setServicesNeedsInputCount] = useState(0);
  const [invoicesUnpaidCount, setInvoicesUnpaidCount] = useState(0);
  const [invoicesOverdueCount, setInvoicesOverdueCount] = useState(0);
  const [ticketsReplyNeededCount, setTicketsReplyNeededCount] = useState(0);

  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!drawerOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [drawerOpen]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    if (loading) return;
    if (role !== "client") {
      router.replace("/portal");
    }
  }, [authLoading, user, role, loading, router]);

  useEffect(() => {
    let alive = true;
    async function loadCounts() {
      if (!tenant?.id || !clientId || role !== "client") return;
      const tid = tenant.id;
      const cid = clientId;
      try {
        // Services needing client action (best-effort + in-memory fallback).
        try {
          const snap = await getDocs(
            query(
              collection(db, "tenants", tid, "services"),
              where("clientId", "==", cid),
              where("health", "==", "waiting_client")
            )
          );
          if (alive) setServicesNeedsInputCount(snap.size);
        } catch {
          const snap = await getDocs(
            query(collection(db, "tenants", tid, "services"), where("clientId", "==", cid))
          );
          const count = snap.docs.reduce((acc, d) => {
            const data = d.data() as { health?: string };
            return acc + (isWaitingClientHealth(data.health) ? 1 : 0);
          }, 0);
          if (alive) setServicesNeedsInputCount(count);
        }

        // Invoices (unpaid + overdue).
        try {
          const unpaidSnap = await getDocs(
            query(
              collection(db, "tenants", tid, "invoices"),
              where("clientId", "==", cid),
              where("status", "==", "unpaid")
            )
          );
          const overdueSnap = await getDocs(
            query(
              collection(db, "tenants", tid, "invoices"),
              where("clientId", "==", cid),
              where("status", "==", "overdue")
            )
          );
          if (alive) {
            setInvoicesUnpaidCount(unpaidSnap.size);
            setInvoicesOverdueCount(overdueSnap.size);
          }
        } catch (err) {
          // Fallback: fetch all invoices for the client and derive in-memory.
          const invSnap = await getDocs(
            query(collection(db, "tenants", tid, "invoices"), where("clientId", "==", cid))
          );
          const derived = invSnap.docs.reduce(
            (acc, d) => {
              const data = d.data() as { status?: string };
              const s = (data.status ?? "").toLowerCase();
              if (s === "unpaid") acc.unpaid += 1;
              if (s === "overdue") acc.overdue += 1;
              return acc;
            },
            { unpaid: 0, overdue: 0 }
          );
          if (alive) {
            setInvoicesUnpaidCount(derived.unpaid);
            setInvoicesOverdueCount(derived.overdue);
          }
        }

        // Support tickets reply needed.
        try {
          const snap = await getDocs(
            query(
              collection(db, "tenants", tid, "tickets"),
              where("clientId", "==", cid),
              where("status", "==", "waiting_client")
            )
          );
          if (alive) setTicketsReplyNeededCount(snap.size);
        } catch {
          const snap = await getDocs(
            query(collection(db, "tenants", tid, "tickets"), where("clientId", "==", cid))
          );
          const fallbackCount = snap.docs.reduce((acc, d) => {
            const data = d.data() as { status?: string };
            return acc + (isTicketReplyNeeded(data.status) ? 1 : 0);
          }, 0);
          if (alive) setTicketsReplyNeededCount(fallbackCount);
        }
      } catch {
        // Non-blocking: nav badges can be omitted if counts fail.
      }
    }

    loadCounts();
    return () => {
      alive = false;
    };
  }, [tenant?.id, clientId, role]);

  if (authLoading) return (
    <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center">
      <p className="text-[#0F172A]">Loading…</p>
    </div>
  );
  if (!user) return null;
  if (loading) return (
    <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center">
      <p className="text-[#0F172A]">Loading…</p>
    </div>
  );
  if (role !== "client") return null;

  return (
    <div className="min-h-screen w-full max-w-[100vw] bg-[#F8FAFC] flex flex-col md:flex-row overflow-x-hidden">
      {/* Mobile top bar — full viewport width; sidebar never shares this row */}
      <header className="md:hidden h-14 w-full bg-white border-b border-slate-200 flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="p-2 -ml-2 rounded-lg text-[#0F172A] hover:bg-slate-100 shrink-0"
            aria-label="Open menu"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="text-[#0F172A] font-semibold truncate">Client Portal</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {tenant?.id ? (
            <NotificationBell
              tenantId={tenant.id}
              role={tenantRole}
              clientId={clientId}
              listPath="/client/notifications"
            />
          ) : null}
          <button
            type="button"
            onClick={() => signOut(auth).then(() => router.replace("/login"))}
            className="text-sm text-slate-500 hover:text-[#0F172A] shrink-0"
          >
            Logout
          </button>
        </div>
      </header>

      {/* Mobile overlay drawer — fixed, does not shrink main column */}
      {drawerOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/40 z-[90] md:hidden"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
          <aside
            className={`fixed inset-y-0 left-0 ${DRAWER_WIDTH_CLASS} bg-white border-r border-slate-200 z-[100] md:hidden flex flex-col shadow-xl`}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
          >
            <div className="p-4 border-b border-slate-200 flex items-center justify-between gap-2 min-w-0">
              <h2 className="text-[#0F172A] font-semibold truncate">Client Portal</h2>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 shrink-0"
                aria-label="Close menu"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <nav className="p-3 space-y-1 overflow-y-auto min-h-0 flex-1">
              <NavLinks
                pathname={pathname}
                onNavigate={() => setDrawerOpen(false)}
                servicesNeedsInputCount={servicesNeedsInputCount}
                invoicesUnpaidCount={invoicesUnpaidCount}
                invoicesOverdueCount={invoicesOverdueCount}
                ticketsReplyNeededCount={ticketsReplyNeededCount}
                notificationCount={notificationCount}
              />
            </nav>
          </aside>
        </>
      )}

      {/* Desktop sidebar */}
      <aside className="hidden md:flex md:flex-col w-64 bg-white border-r border-slate-200 shrink-0">
        <div className="p-6 border-b border-slate-200">
          <h2 className="text-[#0F172A] font-semibold break-words">Client Portal</h2>
        </div>
        <nav className="p-3 space-y-1">
          <NavLinks
            pathname={pathname}
            servicesNeedsInputCount={servicesNeedsInputCount}
            invoicesUnpaidCount={invoicesUnpaidCount}
            invoicesOverdueCount={invoicesOverdueCount}
            ticketsReplyNeededCount={ticketsReplyNeededCount}
            notificationCount={notificationCount}
          />
        </nav>
      </aside>

      {/* Main column: full width of viewport on mobile; drawer is position:fixed and does not participate in flex sizing */}
      <div className="flex flex-1 flex-col min-w-0 w-full max-w-full md:min-h-0">
        <header className="hidden md:flex h-14 w-full bg-white border-b border-slate-200 items-center justify-end gap-2 px-6 shrink-0">
          {tenant?.id ? (
            <NotificationBell
              tenantId={tenant.id}
              role={tenantRole}
              clientId={clientId}
              listPath="/client/notifications"
            />
          ) : null}
          <button
            type="button"
            onClick={() => signOut(auth).then(() => router.replace("/login"))}
            className="text-sm text-slate-500 hover:text-[#0F172A]"
          >
            Logout
          </button>
        </header>
        <main className="relative z-0 flex-1 w-full min-w-0 max-w-full px-3 py-3 sm:px-4 sm:py-4 md:p-6 overflow-x-hidden overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
