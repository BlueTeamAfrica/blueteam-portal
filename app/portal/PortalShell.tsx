"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useTenant } from "@/lib/tenantContext";
import NotificationBell from "@/components/notifications/NotificationBell";
import { useNotificationUnreadCount } from "@/hooks/useNotificationUnreadCount";

const nav = [
  { href: "/portal", label: "Dashboard" },
  { href: "/portal/clients", label: "Clients" },
  { href: "/portal/projects", label: "Projects" },
  { href: "/portal/services", label: "Services" },
  { href: "/portal/invoices", label: "Invoices" },
  { href: "/portal/subscriptions", label: "Subscriptions" },
  { href: "/portal/support", label: "Support" },
  { href: "/portal/notifications", label: "Notifications" },
];

function NavLinks({
  pathname,
  onNavigate,
  notificationCount,
}: {
  pathname: string;
  onNavigate?: () => void;
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
            {item.href === "/portal/notifications" && notificationCount > 0 ? (
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

export default function PortalShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { tenant, role, clientId } = useTenant();
  const notificationCount = useNotificationUnreadCount(tenant?.id, role, clientId);
  const [drawerOpen, setDrawerOpen] = useState(false);

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

  return (
    <div className="min-h-screen w-full max-w-[100vw] bg-[#F8FAFC] flex flex-col md:flex-row overflow-x-hidden">
      {/* Mobile top bar — full width; nav drawer overlays content, does not shrink it */}
      <header className="md:hidden h-14 w-full bg-white border-b border-slate-200 flex items-center justify-between px-4 shrink-0 min-w-0">
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
          <span className="text-[#0F172A] font-semibold truncate">Blue Team Portal</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {tenant?.id ? (
            <NotificationBell
              tenantId={tenant.id}
              role={role}
              clientId={clientId}
              listPath="/portal/notifications"
            />
          ) : null}
          <button
            type="button"
            onClick={() => signOut(auth).then(() => router.replace("/login"))}
            className="text-sm text-slate-500 hover:text-[#0F172A] shrink-0"
          >
            Sign out
          </button>
        </div>
      </header>

      {/* Mobile drawer overlay */}
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
              <h2 className="text-[#0F172A] font-semibold truncate">Blue Team Portal</h2>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="p-2 rounded-lg text-slate-500 hover:bg-slate-100"
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
                notificationCount={notificationCount}
              />
            </nav>
          </aside>
        </>
      )}

      {/* Desktop sidebar */}
      <aside className="hidden md:block w-64 bg-white border-r border-slate-200 shrink-0">
        <div className="p-6 border-b border-slate-200">
          <h2 className="text-[#0F172A] font-semibold break-words">Blue Team Portal</h2>
        </div>
        <nav className="p-3 space-y-1">
          <NavLinks pathname={pathname} notificationCount={notificationCount} />
        </nav>
      </aside>

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Desktop header (tenant + sign out) */}
        <header className="hidden md:flex h-14 bg-white border-b border-slate-200 items-center justify-between px-6 shrink-0">
          <span className="text-[#0F172A] text-sm truncate break-words">{tenant?.name ?? "Tenant"}</span>
          <div className="flex items-center gap-1">
            {tenant?.id ? (
              <NotificationBell
                tenantId={tenant.id}
                role={role}
                clientId={clientId}
                listPath="/portal/notifications"
              />
            ) : null}
            <button
              type="button"
              onClick={() => signOut(auth).then(() => router.replace("/login"))}
              className="text-sm text-slate-500 hover:text-[#0F172A] shrink-0"
            >
              Sign out
            </button>
          </div>
        </header>
        <main className="relative z-0 flex-1 w-full min-w-0 max-w-full px-3 py-3 sm:px-4 sm:py-4 md:px-8 overflow-x-hidden overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
