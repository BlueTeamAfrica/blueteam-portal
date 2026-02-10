"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useAuth } from "@/lib/authContext";
import { useUserProfile } from "@/lib/userProfileContext";

const nav = [
  { href: "/client/dashboard", label: "Dashboard" },
  { href: "/client/projects", label: "Projects" },
  { href: "/client/invoices", label: "Invoices" },
  { href: "/client/subscriptions", label: "Subscriptions" },
];

export default function ClientLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuth();
  const { role, loading } = useUserProfile();

  useEffect(() => {
    if (!user) {
      router.replace("/login");
      return;
    }
    if (loading) return;
    if (role !== "client") {
      router.replace("/portal");
    }
  }, [user, role, loading, router]);

  if (!user) return null;
  if (loading) return (
    <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center">
      <p className="text-[#0F172A]">Loading…</p>
    </div>
  );
  if (role !== "client") return null;

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex">
      <aside className="w-64 bg-white border-r border-slate-200 shrink-0">
        <div className="p-6 border-b border-slate-200">
          <h2 className="text-[#0F172A] font-semibold">Client Portal</h2>
        </div>
        <nav className="p-3 space-y-1">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`block px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                pathname === item.href
                  ? "bg-indigo-50 text-[#4F46E5]"
                  : "text-[#0F172A] hover:bg-slate-100"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 bg-white border-b border-slate-200 flex items-center justify-end px-6 shrink-0">
          <button
            type="button"
            onClick={() => signOut(auth).then(() => router.replace("/login"))}
            className="text-sm text-slate-500 hover:text-[#0F172A]"
          >
            Logout
          </button>
        </header>
        <main className="flex-1 p-6 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
