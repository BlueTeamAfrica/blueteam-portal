"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useAuth } from "@/lib/authContext";
import { useUserProfile } from "@/lib/userProfileContext";

const nav = [
  { href: "/client/dashboard", label: "Dashboard" },
  { href: "/client/projects", label: "Projects" },
  { href: "/client/services", label: "Services" },
  { href: "/client/invoices", label: "Invoices" },
  { href: "/client/subscriptions", label: "Subscriptions" },
  { href: "/client/support", label: "Support" },
];

function NavLinks({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate?: () => void;
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
          {item.label}
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
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col md:flex-row overflow-x-hidden">
      {/* Mobile top bar — full width; does not reserve space beside a sidebar */}
      <header className="md:hidden h-14 bg-white border-b border-slate-200 flex items-center justify-between px-4 shrink-0">
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
        <button
          type="button"
          onClick={() => signOut(auth).then(() => router.replace("/login"))}
          className="text-sm text-slate-500 hover:text-[#0F172A] shrink-0"
        >
          Logout
        </button>
      </header>

      {/* Mobile overlay drawer — fixed, does not shrink main column */}
      {drawerOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/40 z-40 md:hidden"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
          <aside
            className={`fixed inset-y-0 left-0 ${DRAWER_WIDTH_CLASS} bg-white border-r border-slate-200 z-50 md:hidden flex flex-col shadow-xl`}
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
              <NavLinks pathname={pathname} onNavigate={() => setDrawerOpen(false)} />
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
          <NavLinks pathname={pathname} />
        </nav>
      </aside>

      {/* Main: always full width on mobile (flex-1 min-w-0) */}
      <div className="flex-1 flex flex-col min-w-0 max-w-full">
        <header className="hidden md:flex h-14 bg-white border-b border-slate-200 items-center justify-end px-6 shrink-0">
          <button
            type="button"
            onClick={() => signOut(auth).then(() => router.replace("/login"))}
            className="text-sm text-slate-500 hover:text-[#0F172A]"
          >
            Logout
          </button>
        </header>
        <main className="flex-1 px-3 py-3 sm:px-4 sm:py-4 md:p-6 overflow-x-hidden overflow-y-auto min-w-0 max-w-full">
          {children}
        </main>
      </div>
    </div>
  );
}
