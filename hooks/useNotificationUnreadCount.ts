"use client";

import { useEffect, useState } from "react";
import { getCountFromServer } from "firebase/firestore";
import { useAuth } from "@/lib/authContext";
import { roleUnreadNotificationsQuery, userUnreadNotificationsQuery } from "@/lib/notificationsFirestore";

export function useNotificationUnreadCount(
  tenantId: string | undefined,
  role: string | undefined,
  clientId: string | undefined
) {
  const { user } = useAuth();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!tenantId || !user) {
      setCount(0);
      return;
    }
    const tid = tenantId;
    const uid = user.uid;
    const roleLower = (role ?? "").toLowerCase();
    let cancelled = false;

    async function load() {
      try {
        const q1 = userUnreadNotificationsQuery(tid, uid);
        const q2 = roleUnreadNotificationsQuery(tid, roleLower, clientId);
        const [c1, c2] = await Promise.all([getCountFromServer(q1), getCountFromServer(q2)]);
        if (!cancelled) setCount(c1.data().count + c2.data().count);
      } catch {
        if (!cancelled) setCount(0);
      }
    }

    load();
    const t = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [tenantId, user, role, clientId]);

  return count;
}
