"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/authContext";
import { useUserProfile } from "@/lib/userProfileContext";
import PortalShell from "./PortalShell";

export default function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { user } = useAuth();
  const { role, loading } = useUserProfile();

  useEffect(() => {
    if (!user) {
      router.replace("/login");
      return;
    }
    if (loading) return;
    if (role === "client") {
      router.replace("/client/dashboard");
    }
  }, [user, role, loading, router]);

  if (!user) return null;
  if (loading) return (
    <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center">
      <p className="text-[#0F172A]">Loading…</p>
    </div>
  );
  if (role === "client") return null;

  return <PortalShell>{children}</PortalShell>;
}
