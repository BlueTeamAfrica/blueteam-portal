"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function ClientRootPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/client/dashboard");
  }, [router]);

  return null;
}
