"use client";

import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useTenant } from "@/lib/tenantContext";

const nav = [
  { href: "/portal", label: "Dashboard" },
  { href: "/portal/clients", label: "Clients" },
  { href: "/portal/projects", label: "Projects" },
  { href: "/portal/invoices", label: "Invoices" },
  { href: "/portal/subscriptions", label: "Subscriptions" },
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

export default function PortalShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { tenant } = useTenant();
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col md:flex-row">
      {/* Mobile top bar */}
      <header className="md:hidden h-14 bg-white border-b border-slate-200 flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="p-2 -ml-2 rounded-lg text-[#0F172A] hover:bg-slate-100"
            aria-label="Open menu"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="text-[#0F172A] font-semibold truncate">Blue Team Portal</span>
        </div>
        <button
          type="button"
          onClick={() => signOut(auth).then(() => router.replace("/login"))}
          className="text-sm text-slate-500 hover:text-[#0F172A]"
        >
          Sign out
        </button>
      </header>

      {/* Mobile drawer overlay */}
      {drawerOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/40 z-40 md:hidden"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
          <aside
            className="fixed inset-y-0 left-0 w-64 max-w-[85vw] bg-white border-r border-slate-200 z-50 md:hidden flex flex-col shadow-xl"
            role="dialog"
            aria-label="Navigation menu"
          >
            <div className="p-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-[#0F172A] font-semibold">Blue Team Portal</h2>
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
            <nav className="p-3 space-y-1 overflow-auto">
              <NavLinks pathname={pathname} onNavigate={() => setDrawerOpen(false)} />
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
          <NavLinks pathname={pathname} />
        </nav>
      </aside>

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Desktop header (tenant + sign out) */}
        <header className="hidden md:flex h-14 bg-white border-b border-slate-200 items-center justify-between px-6 shrink-0">
          <span className="text-[#0F172A] text-sm truncate break-words">{tenant?.name ?? "Tenant"}</span>
          <button
            type="button"
            onClick={() => signOut(auth).then(() => router.replace("/login"))}
            className="text-sm text-slate-500 hover:text-[#0F172A] shrink-0"
          >
            Sign out
          </button>
        </header>
        <main className="flex-1 px-4 py-4 md:px-8 overflow-auto max-w-full">{children}</main>
      </div>
    </div>
  );
}
